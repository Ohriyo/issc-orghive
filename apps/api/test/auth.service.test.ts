import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@orghive/shared';
import { hashToken } from '#src/lib/crypto';
import { memoryMailer } from '#src/lib/mailer';
import type { PasswordHasher } from '#src/lib/password';
import type { AuditEntry } from '#src/repositories/audit-log.repository';
import type {
  NewRefreshToken,
  RefreshTokenRecord,
} from '#src/repositories/refresh-token.repository';
import type { UserCredentials } from '#src/repositories/user.repository';
import {
  createAuthService,
  REFRESH_TOKEN_TTL_MS,
  SESSION_MAX_AGE_MS,
} from '#src/services/auth.service';

const USER_ID = '0195f3c0-0000-7000-8000-000000000001';
const ISSC_ID = '0195f3c0-0000-7000-8000-0000000000aa';
const T0 = new Date('2026-10-16T08:00:00Z');

/** Plain-text "hashing" so tests run fast; the real Argon2id hasher is covered by route tests. */
function fakeHasher(): PasswordHasher & { dummyCalls: number } {
  const hasher = {
    dummyCalls: 0,
    hash: (p: string) => Promise.resolve(`hashed:${p}`),
    verify: (h: string, p: string) => Promise.resolve(h === `hashed:${p}`),
    verifyDummy: () => {
      hasher.dummyCalls++;
      return Promise.resolve();
    },
  };
  return hasher;
}

function setup(user: Partial<UserCredentials> = {}) {
  let now = T0;
  const users = new Map<string, UserCredentials>([
    [
      USER_ID,
      {
        id: USER_ID,
        email: 'admin@nwssu.test',
        name: 'Admin',
        passwordHash: 'hashed:old password!!',
        mustChangePassword: false,
        disabledAt: null,
        ...user,
      },
    ],
  ]);
  const tokens = new Map<string, RefreshTokenRecord & { tokenHash: string }>();
  const resets = new Map<string, { userId: string; expiresAt: Date; usedAt: Date | null }>();
  const audit: AuditEntry[] = [];
  const mailer = memoryMailer();
  const passwords = fakeHasher();
  const sign = vi.fn((_input: unknown) =>
    Promise.resolve({ token: 'access-token', expiresIn: 900 }),
  );
  let nextId = 0;

  const service = createAuthService({
    users: {
      findByEmail: (email) =>
        Promise.resolve([...users.values()].find((u) => u.email === email) ?? null),
      findById: (id) => Promise.resolve(users.get(id) ?? null),
      setPassword: (id, passwordHash) => {
        users.set(id, { ...users.get(id)!, passwordHash, mustChangePassword: false });
        return Promise.resolve();
      },
    },
    memberships: {
      findActiveForUser: () =>
        Promise.resolve([
          {
            id: 'm1',
            role: 'admin' as const,
            isHead: false,
            title: null,
            organization: { id: ISSC_ID, type: 'ISSC' as const, parentId: null },
          },
        ]),
    },
    refreshTokens: {
      create: (t: NewRefreshToken) => {
        tokens.set(t.tokenHash, {
          ...t,
          id: `rt${nextId++}`,
          revokedAt: null,
          replacedById: null,
        });
        return Promise.resolve();
      },
      findByHash: (h) => Promise.resolve(tokens.get(h) ?? null),
      rotate: (oldId, next, at) => {
        const old = [...tokens.values()].find((t) => t.id === oldId)!;
        if (old.revokedAt) return Promise.resolve(false);
        const id = `rt${nextId++}`;
        tokens.set(next.tokenHash, { ...next, id, revokedAt: null, replacedById: null });
        Object.assign(old, { revokedAt: at, replacedById: id });
        return Promise.resolve(true);
      },
      revokeFamily: (familyId, at) => {
        for (const t of tokens.values()) if (t.familyId === familyId) t.revokedAt ??= at;
        return Promise.resolve();
      },
      revokeAllForUser: (userId, at) => {
        for (const t of tokens.values()) if (t.userId === userId) t.revokedAt ??= at;
        return Promise.resolve();
      },
    },
    resetTokens: {
      create: (t, at) => {
        for (const r of resets.values()) if (r.userId === t.userId) r.usedAt ??= at;
        resets.set(t.tokenHash, { userId: t.userId, expiresAt: t.expiresAt, usedAt: null });
        return Promise.resolve();
      },
      consume: (h, at) => {
        const r = resets.get(h);
        if (!r || r.usedAt || r.expiresAt <= at) return Promise.resolve(null);
        r.usedAt = at;
        return Promise.resolve(r.userId);
      },
    },
    audit: {
      record: (e) => {
        audit.push(e);
        return Promise.resolve();
      },
    },
    tokens: { sign },
    passwords,
    mailer,
    logger: pino({ level: 'silent' }),
    webOrigin: 'http://localhost:5173',
    now: () => now,
  });

  return {
    service,
    users,
    tokens,
    audit,
    mailer,
    passwords,
    sign,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    live: () => [...tokens.values()].filter((t) => !t.revokedAt),
  };
}

const ctx = { ip: '203.0.113.9', userAgent: 'vitest' };
const login = (s: ReturnType<typeof setup>, password = 'old password!!') =>
  s.service.login({ email: 'admin@nwssu.test', password }, ctx);

describe('authService.login', () => {
  it('starts a session: a 7-day refresh token inside a 30-day session, and an access token with roles', async () => {
    const s = setup();
    const { auth, refresh } = await login(s);

    expect(auth.user.roles).toEqual([{ orgId: ISSC_ID, role: 'admin', isHead: false }]);
    expect(s.sign).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, isAdmin: true, passwordChangeRequired: false }),
    );
    expect(refresh.expiresAt.getTime()).toBe(T0.getTime() + REFRESH_TOKEN_TTL_MS);
    const stored = s.tokens.get(hashToken(refresh.token))!;
    expect(stored.sessionExpiresAt.getTime()).toBe(T0.getTime() + SESSION_MAX_AGE_MS);
    expect(s.audit.map((a) => a.action)).toEqual(['login']);
  });

  it('runs a dummy verify for an unknown email, then fails like a wrong password', async () => {
    const s = setup();
    const unknown = s.service.login({ email: 'who@nwssu.test', password: 'whatever' }, ctx);
    await expect(unknown).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
    expect(s.passwords.dummyCalls).toBe(1);
    await expect(login(s, 'wrong')).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
    expect(s.audit.map((a) => a.metadata)).toEqual([
      { email: 'who@nwssu.test', reason: 'unknown_email' },
      { reason: 'wrong_password' },
    ]);
  });

  it('refuses a disabled account and flags a temporary password in the token', async () => {
    await expect(login(setup({ disabledAt: T0 }))).rejects.toMatchObject({ status: 401 });
    const s = setup({ mustChangePassword: true });
    expect((await login(s)).auth.user.mustChangePassword).toBe(true);
    expect(s.sign).toHaveBeenCalledWith(expect.objectContaining({ passwordChangeRequired: true }));
  });
});

describe('authService.refresh', () => {
  it('rotates within the family and never extends past the session cap', async () => {
    const DAY = 24 * 3600_000;
    const s = setup();
    const first = await login(s);
    const rowA = s.tokens.get(hashToken(first.refresh.token))!;

    // A browser in daily use refreshes well inside each 7-day window.
    s.advance(6 * DAY);
    const second = await s.service.refresh(first.refresh.token, ctx);
    const rowB = s.tokens.get(hashToken(second.refresh.token))!;
    expect(second.refresh.token).not.toBe(first.refresh.token);
    expect(rowB.familyId).toBe(rowA.familyId);
    expect(rowB.sessionExpiresAt).toEqual(rowA.sessionExpiresAt);
    expect(rowA.replacedById).toBe(rowB.id);

    // Keep going to day 28: the newest token expires with the session (day 30), not on day 35.
    let current = second;
    for (const days of [6, 6, 6, 4]) {
      s.advance(days * DAY);
      current = await s.service.refresh(current.refresh.token, ctx);
    }
    expect(current.refresh.expiresAt).toEqual(rowA.sessionExpiresAt);

    // On day 30 the session is over, however recently it was refreshed.
    s.advance(SESSION_MAX_AGE_MS - 28 * DAY);
    await expect(s.service.refresh(current.refresh.token, ctx)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('treats a rotated token presented again as theft: revokes the family and audits', async () => {
    const s = setup();
    const { refresh: stolen } = await login(s);
    await s.service.refresh(stolen.token, ctx);

    await expect(s.service.refresh(stolen.token, ctx)).rejects.toMatchObject({ status: 401 });
    expect(s.live()).toHaveLength(0);
    expect(s.audit.at(-1)).toMatchObject({ action: 'token_reuse', actorId: USER_ID });
  });

  it('ends quietly for unknown, logged-out and disabled-user tokens', async () => {
    const s = setup();
    await expect(s.service.refresh('unknown', ctx)).rejects.toMatchObject({ status: 401 });

    const { refresh } = await login(s);
    await s.service.logout(refresh.token, ctx);
    await expect(s.service.refresh(refresh.token, ctx)).rejects.toMatchObject({ status: 401 });
    expect(s.audit.map((a) => a.action)).not.toContain('token_reuse');

    const d = setup();
    const session = await login(d);
    d.users.set(USER_ID, { ...d.users.get(USER_ID)!, disabledAt: T0 });
    await expect(d.service.refresh(session.refresh.token, ctx)).rejects.toMatchObject({
      status: 401,
    });
    expect(d.live()).toHaveLength(0);
  });
});

describe('authService.logout', () => {
  it('revokes the family and audits; a missing or unknown token is a no-op', async () => {
    const s = setup();
    const { refresh } = await login(s);
    await s.service.logout(undefined, ctx);
    await s.service.logout('unknown', ctx);
    expect(s.live()).toHaveLength(1);
    await s.service.logout(refresh.token, ctx);
    expect(s.live()).toHaveLength(0);
    expect(s.audit.at(-1)).toMatchObject({ action: 'logout', actorId: USER_ID });
  });
});

describe('authService.requestPasswordReset / resetPassword', () => {
  it('emails a fragment link; the token works once and ends every session', async () => {
    const s = setup();
    await login(s);
    await s.service.requestPasswordReset('admin@nwssu.test', ctx);
    const token = /#token=([\w-]{43})/.exec(s.mailer.sent[0]!.text)![1]!;
    expect(s.mailer.sent[0]!.html).toContain('href="http://localhost:5173/reset-password#token=');

    await s.service.resetPassword({ token, newPassword: 'a new passphrase!' }, ctx);
    expect(s.users.get(USER_ID)!.passwordHash).toBe('hashed:a new passphrase!');
    expect(s.live()).toHaveLength(0);
    await expect(
      s.service.resetPassword({ token, newPassword: 'another passphrase' }, ctx),
    ).rejects.toMatchObject({ status: 400, code: ErrorCode.INVALID_RESET_TOKEN });
  });

  it('sends nothing for an unknown or disabled account, and expires links after 30 minutes', async () => {
    const s = setup({ disabledAt: T0 });
    await s.service.requestPasswordReset('admin@nwssu.test', ctx);
    await s.service.requestPasswordReset('nobody@nwssu.test', ctx);
    expect(s.mailer.sent).toHaveLength(0);

    const e = setup();
    await e.service.requestPasswordReset('admin@nwssu.test', ctx);
    const token = /#token=([\w-]{43})/.exec(e.mailer.sent[0]!.text)![1]!;
    e.advance(30 * 60_000);
    await expect(
      e.service.resetPassword({ token, newPassword: 'a new passphrase!' }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_RESET_TOKEN });
  });

  it('escapes the user name in the HTML email', async () => {
    const s = setup({ name: '<img src=x onerror=alert(1)>' });
    await s.service.requestPasswordReset('admin@nwssu.test', ctx);
    expect(s.mailer.sent[0]!.html).not.toContain('<img');
  });
});

describe('authService.changePassword / me', () => {
  it('replaces a temporary password, ends other sessions and starts a fresh one', async () => {
    const s = setup({ mustChangePassword: true });
    const old = await login(s);
    const result = await s.service.changePassword(
      USER_ID,
      { currentPassword: 'old password!!', newPassword: 'a new passphrase!' },
      ctx,
    );
    expect(result.auth.user.mustChangePassword).toBe(false);
    expect(s.tokens.get(hashToken(old.refresh.token))!.revokedAt).not.toBeNull();
    expect(s.live()).toHaveLength(1);
    expect(s.audit.at(-1)).toMatchObject({ action: 'password_change', metadata: { forced: true } });
  });

  it('refuses a wrong current password with 400, not 401', async () => {
    const s = setup();
    await expect(
      s.service.changePassword(
        USER_ID,
        { currentPassword: 'nope', newPassword: 'a new passphrase!' },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 400, code: ErrorCode.INVALID_CREDENTIALS });
  });

  it('returns the user with fresh roles, and 401 once disabled', async () => {
    const s = setup();
    expect(await s.service.me(USER_ID)).toMatchObject({ id: USER_ID, roles: [{ role: 'admin' }] });
    s.users.set(USER_ID, { ...s.users.get(USER_ID)!, disabledAt: T0 });
    await expect(s.service.me(USER_ID)).rejects.toMatchObject({ status: 401 });
  });
});
