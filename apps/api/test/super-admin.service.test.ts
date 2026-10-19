import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@orghive/shared';
import { memoryMailer } from '#src/lib/mailer';
import type { PasswordHasher } from '#src/lib/password';
import { normalizeRecoveryCode } from '#src/lib/recovery-codes';
import { createSecretBox, generateSecretBoxKey } from '#src/lib/secret-box';
import { memorySuperAdminStore } from '#src/lib/super-admin-store';
import { createTotp } from '#src/lib/totp';
import type { AuditEntry } from '#src/repositories/audit-log.repository';
import type { UserCredentials } from '#src/repositories/user.repository';
import {
  createSuperAdminService,
  LOCKOUT_THRESHOLD,
  MFA_CHALLENGE_TTL_SECONDS,
} from '#src/services/super-admin.service';

const USER_ID = '0195f3c0-0000-7000-8000-000000000001';
const SESSION = '0195f3c0-0000-7000-8000-0000000000ff';
const T0 = new Date('2026-10-19T08:00:00Z');
const MINUTE = 60_000;
const ctx = { ip: '203.0.113.9', userAgent: 'vitest' };
const totp = createTotp();
const secrets = createSecretBox(generateSecretBoxKey());

function fakeHasher(): PasswordHasher {
  return {
    hash: (p) => Promise.resolve(`hashed:${p}`),
    verify: (h, p) => Promise.resolve(h === `hashed:${p}`),
    verifyDummy: () => Promise.resolve(),
  };
}

function setup(user: Partial<UserCredentials> = {}) {
  let now = T0;
  const secret = totp.generateSecret();
  const users = new Map<string, UserCredentials>([
    [
      USER_ID,
      {
        id: USER_ID,
        email: 'dev@nwssu.test',
        name: 'Dev',
        passwordHash: 'hashed:x',
        mustChangePassword: false,
        disabledAt: null,
        lockedAt: null,
        systemRole: 'SUPER_ADMIN',
        mfaSecret: secrets.seal(secret, USER_ID),
        mfaEnabledAt: T0,
        mfaLastTimeStep: null,
        ...user,
      },
    ],
  ]);
  let codes: { id: string; codeHash: string; usedAt: Date | null }[] = [];
  const audit: AuditEntry[] = [];
  const revoked: string[] = [];
  const mailer = memoryMailer();
  const store = memorySuperAdminStore(() => now);

  const service = createSuperAdminService({
    users: {
      findById: (id) => Promise.resolve(users.get(id) ?? null),
      recordTotpStep: (id, step) => {
        const u = users.get(id)!;
        if (u.mfaLastTimeStep !== null && u.mfaLastTimeStep >= step) return Promise.resolve(false);
        users.set(id, { ...u, mfaLastTimeStep: step });
        return Promise.resolve(true);
      },
      enableMfa: (id, hashes, at) => {
        users.set(id, { ...users.get(id)!, mfaEnabledAt: at });
        codes = hashes.map((codeHash, i) => ({ id: `rc${i}`, codeHash, usedAt: null }));
        return Promise.resolve();
      },
    },
    recoveryCodes: {
      listUnused: () => Promise.resolve(codes.filter((c) => !c.usedAt)),
      countUnused: () => Promise.resolve(codes.filter((c) => !c.usedAt).length),
      markUsed: (id, at) => {
        const code = codes.find((c) => c.id === id && !c.usedAt);
        if (code) code.usedAt = at;
        return Promise.resolve(Boolean(code));
      },
      replaceAll: (_userId, hashes) => {
        codes = hashes.map((codeHash, i) => ({ id: `new${i}`, codeHash, usedAt: null }));
        return Promise.resolve();
      },
    },
    system: { activeSuperAdminEmails: () => Promise.resolve(['dev@nwssu.test', 'ops@nwssu.test']) },
    refreshTokens: {
      revokeFamily: (familyId) => {
        revoked.push(familyId);
        return Promise.resolve();
      },
    },
    store,
    totp,
    secrets,
    passwords: fakeHasher(),
    audit: {
      record: (e) => {
        audit.push(e);
        return Promise.resolve();
      },
    },
    mailer,
    logger: pino({ level: 'silent' }),
    now: () => now,
  });

  return {
    service,
    store,
    users,
    audit,
    mailer,
    revoked,
    codes: () => codes,
    /** The code for the current clock. */
    code: () => totp.generate(secret, now),
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    actions: () => audit.map((a) => a.action),
  };
}

describe('superAdminService sign-in challenge', () => {
  it('completes once with a right TOTP code, and never accepts the same code again', async () => {
    const s = setup();
    const { challengeToken, expiresIn } = await s.service.createChallenge(USER_ID);
    expect(expiresIn).toBe(MFA_CHALLENGE_TTL_SECONDS);

    const code = await s.code();
    const result = await s.service.completeChallenge(challengeToken, code, ctx);
    expect(result).toMatchObject({ method: 'totp', user: { id: USER_ID } });
    await expect(s.service.completeChallenge(challengeToken, code, ctx)).rejects.toMatchObject({
      status: 401,
    });

    const next = await s.service.createChallenge(USER_ID);
    await expect(s.service.completeChallenge(next.challengeToken, code, ctx)).rejects.toMatchObject(
      { status: 400, code: ErrorCode.INVALID_MFA_CODE },
    );
    expect(s.audit.at(-1)).toMatchObject({
      action: 'mfa_failed',
      metadata: { stage: 'login', method: 'totp' },
      userAgent: 'vitest',
    });
  });

  it('expires the challenge after 5 minutes', async () => {
    const s = setup();
    const { challengeToken } = await s.service.createChallenge(USER_ID);
    s.advance(MFA_CHALLENGE_TTL_SECONDS * 1000 + 1);
    await expect(
      s.service.completeChallenge(challengeToken, await s.code(), ctx),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('refuses the challenge of an account that was disabled or demoted meanwhile', async () => {
    for (const change of [{ disabledAt: T0 }, { systemRole: 'NONE' as const }]) {
      const s = setup();
      const { challengeToken } = await s.service.createChallenge(USER_ID);
      s.users.set(USER_ID, { ...s.users.get(USER_ID)!, ...change });
      await expect(
        s.service.completeChallenge(challengeToken, await s.code(), ctx),
      ).rejects.toMatchObject({ status: 401 });
    }
  });

  it('accepts each recovery code once and audits how many remain', async () => {
    const s = setup({ mfaEnabledAt: null });
    const codes = await s.service.confirmSetup(USER_ID, await s.code(), ctx);
    expect(codes).toHaveLength(10);
    expect(s.codes()[0]!.codeHash).toBe(`hashed:${normalizeRecoveryCode(codes[0]!)}`);

    const first = await s.service.createChallenge(USER_ID);
    const result = await s.service.completeChallenge(first.challengeToken, codes[3]!, ctx);
    expect(result.method).toBe('recovery');
    expect(s.audit.at(-1)).toMatchObject({
      action: 'mfa_recovery_used',
      metadata: { remaining: 9 },
    });

    const again = await s.service.createChallenge(USER_ID);
    await expect(
      s.service.completeChallenge(again.challengeToken, codes[3]!, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_MFA_CODE });
    await expect(
      s.service.completeChallenge(again.challengeToken, 'not a code at all!', ctx),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_MFA_CODE });
  });
});

describe('superAdminService lockout', () => {
  it('locks after 5 failures, alerts every super admin once, and lifts after 15 minutes', async () => {
    const s = setup();
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
      await s.service.countFailure({ id: USER_ID, email: 'dev@nwssu.test' }, ctx, 'password');
    }
    await expect(s.service.ensureNotLockedOut(USER_ID, ctx)).rejects.toMatchObject({
      status: 429,
      code: ErrorCode.RATE_LIMITED,
    });
    // The same IP is locked for other super admin accounts too.
    await expect(s.service.ensureNotLockedOut('another', ctx)).rejects.toMatchObject({
      status: 429,
    });
    await s.service.ensureNotLockedOut('another', { ip: '198.51.100.1' });

    await s.service.countFailure({ id: USER_ID, email: 'dev@nwssu.test' }, ctx, 'login');
    expect(s.actions().filter((a) => a === 'super_admin_lockout')).toHaveLength(1);
    expect(s.mailer.sent.map((m) => m.to)).toEqual(['dev@nwssu.test', 'ops@nwssu.test']);
    expect(s.mailer.sent[0]!.html).toContain('dev@nwssu.test');

    s.advance(15 * MINUTE + 1);
    await s.service.ensureNotLockedOut(USER_ID, ctx);
  });

  it('counts wrong codes at every stage', async () => {
    const s = setup();
    const { challengeToken } = await s.service.createChallenge(USER_ID);
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
      await expect(s.service.completeChallenge(challengeToken, '000000', ctx)).rejects.toThrow();
    }
    await expect(
      s.service.completeChallenge(challengeToken, await s.code(), ctx),
    ).rejects.toMatchObject({ status: 429 });
  });
});

describe('superAdminService.confirmSetup', () => {
  it('confirms the pending authenticator with a first code and returns 10 recovery codes', async () => {
    const s = setup({ mfaEnabledAt: null });
    await expect(s.service.confirmSetup(USER_ID, '000000', ctx)).rejects.toMatchObject({
      code: ErrorCode.INVALID_MFA_CODE,
    });
    expect(s.audit.at(-1)).toMatchObject({ metadata: { stage: 'setup' } });

    const codes = await s.service.confirmSetup(USER_ID, await s.code(), ctx);
    expect(new Set(codes).size).toBe(10);
    expect(codes.every((c) => /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(c))).toBe(true);
    expect(s.users.get(USER_ID)!.mfaEnabledAt).toEqual(T0);
    expect(s.audit.at(-1)).toMatchObject({ action: 'mfa_enroll' });
  });

  it('refuses a second setup, and accounts without a pending authenticator', async () => {
    await expect(setup().service.confirmSetup(USER_ID, '123456', ctx)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      setup({ mfaEnabledAt: null, mfaSecret: null }).service.confirmSetup(USER_ID, '123456', ctx),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('superAdminService step-up', () => {
  it('unlocks destructive actions for exactly 5 minutes', async () => {
    const s = setup();
    await s.service.startSession(SESSION, T0);
    await expect(s.service.requireStepUp(SESSION)).rejects.toMatchObject({
      status: 403,
      code: ErrorCode.STEP_UP_REQUIRED,
    });

    const { stepUpExpiresAt } = await s.service.stepUp(USER_ID, SESSION, await s.code(), ctx);
    expect(stepUpExpiresAt).toBe(new Date(T0.getTime() + 5 * MINUTE).toISOString());
    await s.service.requireStepUp(SESSION);
    expect(s.audit.at(-1)).toMatchObject({ action: 'step_up', userAgent: 'vitest' });

    s.advance(5 * MINUTE);
    await s.service.requireStepUp(SESSION);
    s.advance(1);
    await expect(s.service.requireStepUp(SESSION)).rejects.toMatchObject({
      code: ErrorCode.STEP_UP_REQUIRED,
    });
  });

  it('refuses a wrong code and counts it', async () => {
    const s = setup();
    await s.service.startSession(SESSION, T0);
    await expect(s.service.stepUp(USER_ID, SESSION, '000000', ctx)).rejects.toMatchObject({
      code: ErrorCode.INVALID_MFA_CODE,
    });
    expect(s.audit.at(-1)).toMatchObject({ metadata: { stage: 'step_up' } });
    await expect(s.service.requireStepUp(SESSION)).rejects.toThrow();
  });
});

describe('superAdminService sessions', () => {
  it('ends after 15 idle minutes; background requests check but do not count', async () => {
    const s = setup();
    await s.service.startSession(SESSION, T0);

    s.advance(14 * MINUTE);
    await s.service.checkSession(SESSION, { background: false });
    s.advance(14 * MINUTE);
    await s.service.checkSession(SESSION, { background: true });
    s.advance(2 * MINUTE);
    await expect(s.service.checkSession(SESSION, { background: false })).rejects.toMatchObject({
      status: 401,
    });
    expect(s.revoked).toEqual([SESSION]);
    expect(await s.store.getSession(SESSION)).toBeNull();
  });

  it('ends 8 hours after sign-in, however active', async () => {
    const s = setup();
    await s.service.startSession(SESSION, T0);
    for (let elapsed = 0; elapsed < 8 * 60 - 10; elapsed += 10) {
      s.advance(10 * MINUTE);
      await s.service.checkSession(SESSION, { background: false });
    }
    s.advance(10 * MINUTE + 1);
    await expect(s.service.checkSession(SESSION, { background: false })).rejects.toMatchObject({
      status: 401,
    });
  });

  it('treats an unknown or ended session as over', async () => {
    const s = setup();
    await expect(s.service.checkSession(SESSION, { background: true })).rejects.toMatchObject({
      status: 401,
    });
    await s.service.startSession(SESSION, T0);
    await s.service.endSession(SESSION);
    await expect(s.service.checkSession(SESSION, { background: false })).rejects.toThrow();
  });

  it('reports the session and MFA state for the security page', async () => {
    const s = setup();
    await s.service.startSession(SESSION, T0);
    expect(await s.service.security(USER_ID, SESSION)).toEqual({
      mfaEnabledAt: T0.toISOString(),
      recoveryCodesRemaining: 0,
      sessionStartedAt: T0.toISOString(),
      sessionExpiresAt: new Date(T0.getTime() + 8 * 60 * MINUTE).toISOString(),
      idleTimeoutSeconds: 900,
      stepUpExpiresAt: null,
    });
    await s.service.stepUp(USER_ID, SESSION, await s.code(), ctx);
    expect((await s.service.security(USER_ID, SESSION)).stepUpExpiresAt).toBe(
      new Date(T0.getTime() + 5 * MINUTE).toISOString(),
    );
    await expect(s.service.security(USER_ID, 'gone')).rejects.toMatchObject({ status: 401 });
  });

  it('replaces every recovery code on request', async () => {
    const s = setup({ mfaEnabledAt: null });
    const old = await s.service.confirmSetup(USER_ID, await s.code(), ctx);
    const fresh = await s.service.regenerateRecoveryCodes(USER_ID, ctx);
    expect(fresh).toHaveLength(10);
    expect(fresh).not.toContain(old[0]);
    expect(s.codes().map((c) => c.id)).toEqual(fresh.map((_, i) => `new${i}`));
    expect(s.audit.at(-1)).toMatchObject({ action: 'recovery_codes_regenerate' });
  });
});
