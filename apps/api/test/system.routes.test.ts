import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  authResponseSchema,
  BACKGROUND_REQUEST_HEADER,
  ErrorCode,
  mfaChallengeSchema,
  mfaSetupResponseSchema,
  stepUpResponseSchema,
  systemUserListResponseSchema,
} from '@orghive/shared';
import {
  accountFor,
  buildAuthApp,
  createSuperAdmin,
  createUser,
  refreshCookieOf,
  TEST_PASSWORD,
  totpCode,
} from './auth-fixtures';
import { buildWorld, resetDb, testDb } from './db';
import { TEST_WEB_ORIGIN } from './helpers';
import { testRedis } from './redis';

/*
 * /api/v1/system end to end, on the test database and Redis: who gets in (the role
 * matrix), the super admin MFA flow, step-up expiry, the idle timeout, the lockout and the
 * last-super-admin guard.
 */

const db = testDb();
const redis = testRedis();

/** The services' clock. Access tokens use real time, so it only ever moves forward a little. */
let clock: Date;
const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};
const STEP = 30_000;
const MINUTE = 60_000;

beforeEach(async () => {
  clock = new Date();
  await redis.flushdb();
  await resetDb(db);
});

afterAll(async () => {
  await redis.quit();
});

function build() {
  return buildAuthApp(db, redis, { now: () => clock });
}
type App = ReturnType<typeof build>['app'];

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

function passwordLogin(app: App, email: string) {
  return request(app).post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD });
}

/** Signs in with password + TOTP. Moves the clock a step first, so each code is fresh. */
async function superAdminSession(app: App, email: string, secret: string) {
  advance(STEP);
  const first = await passwordLogin(app, email).expect(200);
  const { challengeToken } = mfaChallengeSchema.parse(first.body);
  const res = await request(app)
    .post('/api/v1/auth/mfa/verify')
    .send({ challengeToken, code: await totpCode(secret, { at: clock }) })
    .expect(200);
  return {
    accessToken: authResponseSchema.parse(res.body).accessToken,
    cookie: refreshCookieOf(res)!,
  };
}

async function stepUp(app: App, accessToken: string, secret: string) {
  advance(STEP);
  return request(app)
    .post('/api/v1/system/step-up')
    .set(bearer(accessToken))
    .send({ code: await totpCode(secret, { at: clock }) });
}

/** An organization's shared account (the ISSC's is the "ISSC admin"). */
function orgUser(email: string, organizationId: string) {
  return accountFor(db, organizationId, email);
}

async function accessTokenOf(app: App, email: string) {
  const res = await passwordLogin(app, email).expect(200);
  return authResponseSchema.parse(res.body).accessToken;
}

const READS = [
  '/api/v1/system/overview',
  '/api/v1/system/users',
  '/api/v1/system/audit-logs',
  '/api/v1/system/me/security',
];

describe('/system role matrix', () => {
  it('lets only an active super admin with MFA in', async () => {
    const world = await buildWorld(db);
    const { app } = build();
    await orgUser('officer@nwssu.test', world.orgs.jpice.id);
    await orgUser('admin@nwssu.test', world.orgs.issc.id);
    const { user: target } = await createSuperAdmin(db, 'pending@nwssu.test', { pending: true });
    const { secret } = await createSuperAdmin(db, 'dev@nwssu.test');

    const officer = await accessTokenOf(app, 'officer@nwssu.test');
    const isscAdmin = await accessTokenOf(app, 'admin@nwssu.test');
    const pending = await accessTokenOf(app, 'pending@nwssu.test');
    const superAdmin = (await superAdminSession(app, 'dev@nwssu.test', secret)).accessToken;

    const writes = [
      () => request(app).post('/api/v1/system/step-up').send({ code: '123456' }),
      () => request(app).post('/api/v1/system/me/recovery-codes'),
      () => request(app).patch(`/api/v1/system/users/${target.id}/status`).send({ active: false }),
      () =>
        request(app)
          .patch(`/api/v1/system/users/${target.id}/system-role`)
          .send({ systemRole: 'NONE' }),
    ];
    const reads = READS.map((path) => () => request(app).get(path));

    for (const call of [...reads, ...writes]) {
      expect((await call()).status).toBe(401);
      for (const token of [officer, isscAdmin]) {
        const res = await call().set(bearer(token));
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe(ErrorCode.FORBIDDEN);
      }
      const notSetUp = await call().set(bearer(pending));
      expect(notSetUp.status).toBe(403);
      expect(notSetUp.body.error.code).toBe(ErrorCode.MFA_SETUP_REQUIRED);
    }

    for (const read of reads) {
      const res = await read().set(bearer(superAdmin)).expect(200);
      expect(res.headers['cache-control']).toBe('private, no-store');
    }
    // Destructive actions wait for a step-up.
    for (const write of writes.slice(1)) {
      const res = await write().set(bearer(superAdmin));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ErrorCode.STEP_UP_REQUIRED);
    }
  });

  it('checks the database on every request: a demoted super admin is out at once', async () => {
    const { app } = build();
    const { user, secret } = await createSuperAdmin(db, 'dev@nwssu.test');
    const { accessToken } = await superAdminSession(app, 'dev@nwssu.test', secret);
    await db.user.update({ where: { id: user.id }, data: { systemRole: 'NONE' } });

    const res = await request(app).get('/api/v1/system/overview').set(bearer(accessToken));
    expect(res.status).toBe(403);
  });

  it('audits every console read with actor, IP and user agent', async () => {
    const { app } = build();
    const { user, secret } = await createSuperAdmin(db, 'dev@nwssu.test');
    const { accessToken } = await superAdminSession(app, 'dev@nwssu.test', secret);

    await request(app)
      .get('/api/v1/system/users?status=active')
      .set(bearer(accessToken))
      .set('User-Agent', 'console-test')
      .expect(200);

    const entry = await db.auditLog.findFirstOrThrow({ where: { action: 'system_view' } });
    expect(entry).toMatchObject({
      actorId: user.id,
      userAgent: 'console-test',
      metadata: { route: '/api/v1/system/users' },
    });
    expect(entry.ip).toBeTruthy();
  });

  it('filters the audit log by part of an "Acting as" name, any case, and shows it', async () => {
    const { app } = build();
    const { secret } = await createSuperAdmin(db, 'dev@nwssu.test');
    const { accessToken } = await superAdminSession(app, 'dev@nwssu.test', secret);
    for (const actingAs of ['Juan Dela Cruz', 'Maria Santos', null]) {
      await db.auditLog.create({
        data: { action: 'upload', entityType: 'document', entityId: crypto.randomUUID(), actingAs },
      });
    }

    const res = await request(app)
      .get('/api/v1/system/audit-logs?actingAs=dela%20CRUZ')
      .set(bearer(accessToken))
      .expect(200);
    const items = (res.body as { items: { action: string; actingAs: string | null }[] }).items;
    expect(items).toEqual([
      expect.objectContaining({ action: 'upload', actingAs: 'Juan Dela Cruz' }),
    ]);

    await request(app)
      .get(`/api/v1/system/audit-logs?actingAs=${'x'.repeat(81)}`)
      .set(bearer(accessToken))
      .expect(400);
  });
});

describe('super admin sign-in with MFA', () => {
  it('asks for a code after the password, and starts the session only when it is right', async () => {
    const { app } = build();
    const { secret } = await createSuperAdmin(db, 'dev@nwssu.test');

    advance(STEP);
    const first = await passwordLogin(app, 'dev@nwssu.test').expect(200);
    const { challengeToken } = mfaChallengeSchema.parse(first.body);
    expect(refreshCookieOf(first)).toBeUndefined();
    expect(JSON.stringify(first.body)).not.toContain('accessToken');

    const wrong = await request(app)
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeToken, code: '000000' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe(ErrorCode.INVALID_MFA_CODE);

    const code = await totpCode(secret, { at: clock });
    const ok = await request(app)
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeToken, code })
      .expect(200);
    expect(authResponseSchema.parse(ok.body).user.systemRole).toBe('SUPER_ADMIN');
    expect(refreshCookieOf(ok)).toBeDefined();

    // The challenge is spent, and the same code never works twice.
    const again = await request(app).post('/api/v1/auth/mfa/verify').send({ challengeToken, code });
    expect(again.status).toBe(401);
    const second = mfaChallengeSchema.parse((await passwordLogin(app, 'dev@nwssu.test')).body);
    const replay = await request(app)
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeToken: second.challengeToken, code });
    expect(replay.body.error.code).toBe(ErrorCode.INVALID_MFA_CODE);
  });

  it('holds a super admin without MFA at setup, then gives recovery codes that sign in once', async () => {
    const { app } = build();
    const { secret } = await createSuperAdmin(db, 'dev@nwssu.test', { pending: true });

    const setupLogin = await passwordLogin(app, 'dev@nwssu.test').expect(200);
    const setupSession = authResponseSchema.parse(setupLogin.body);
    expect(setupSession.user.mfaSetupRequired).toBe(true);
    await request(app).get('/api/v1/auth/me').set(bearer(setupSession.accessToken)).expect(200);
    const blocked = await request(app)
      .get('/api/v1/system/overview')
      .set(bearer(setupSession.accessToken));
    expect(blocked.body.error.code).toBe(ErrorCode.MFA_SETUP_REQUIRED);

    advance(STEP);
    const confirmed = await request(app)
      .post('/api/v1/auth/mfa/setup')
      .set(bearer(setupSession.accessToken))
      .send({ code: await totpCode(secret, { at: clock }) })
      .expect(200);
    const { recoveryCodes, accessToken } = mfaSetupResponseSchema.parse(confirmed.body);
    expect(new Set(recoveryCodes).size).toBe(10);
    await request(app).get('/api/v1/system/overview').set(bearer(accessToken)).expect(200);

    // The setup session is over.
    const oldRefresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', TEST_WEB_ORIGIN)
      .set('Cookie', `orghive_rt=${refreshCookieOf(setupLogin)}`);
    expect(oldRefresh.status).toBe(401);

    // A recovery code signs in once, in any case and with or without the dash.
    const recovery = recoveryCodes[0]!.toUpperCase().replace('-', ' ');
    const challenge = mfaChallengeSchema.parse((await passwordLogin(app, 'dev@nwssu.test')).body);
    await request(app)
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeToken: challenge.challengeToken, code: recovery })
      .expect(200);
    const reuse = mfaChallengeSchema.parse((await passwordLogin(app, 'dev@nwssu.test')).body);
    const used = await request(app)
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeToken: reuse.challengeToken, code: recoveryCodes[0] });
    expect(used.body.error.code).toBe(ErrorCode.INVALID_MFA_CODE);
    expect(await db.auditLog.count({ where: { action: 'mfa_recovery_used' } })).toBe(1);
  });

  it('locks the account after 5 failures in 15 minutes and emails the super admins once', async () => {
    const { app, mailer } = build();
    const { secret } = await createSuperAdmin(db, 'dev@nwssu.test');
    await createSuperAdmin(db, 'other@nwssu.test');

    const challenge = mfaChallengeSchema.parse((await passwordLogin(app, 'dev@nwssu.test')).body);
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/v1/auth/mfa/verify')
        .send({ challengeToken: challenge.challengeToken, code: '000000' })
        .expect(400);
    }
    const locked = await request(app)
      .post('/api/v1/auth/mfa/verify')
      .send({
        challengeToken: challenge.challengeToken,
        code: await totpCode(secret, { at: clock }),
      });
    expect(locked.status).toBe(429);
    expect((await passwordLogin(app, 'dev@nwssu.test')).status).toBe(429);

    expect(await db.auditLog.count({ where: { action: 'super_admin_lockout' } })).toBe(1);
    expect(mailer.sent.map((m) => m.to).sort()).toEqual(['dev@nwssu.test', 'other@nwssu.test']);
    expect(mailer.sent[0]!.subject).toMatch(/locked/);
  });
});

describe('step-up and session limits', () => {
  it('unlocks destructive actions for 5 minutes after a fresh code', async () => {
    const { app } = build();
    const { secret } = await createSuperAdmin(db, 'dev@nwssu.test');
    const target = await createUser(db, 'student@nwssu.test');
    const { accessToken } = await superAdminSession(app, 'dev@nwssu.test', secret);
    const deactivate = (active: boolean) =>
      request(app)
        .patch(`/api/v1/system/users/${target.id}/status`)
        .set(bearer(accessToken))
        .send({ active });

    const wrong = await request(app)
      .post('/api/v1/system/step-up')
      .set(bearer(accessToken))
      .send({ code: '000000' });
    expect(wrong.body.error.code).toBe(ErrorCode.INVALID_MFA_CODE);

    const passed = await stepUp(app, accessToken, secret);
    expect(passed.status).toBe(200);
    const { stepUpExpiresAt } = stepUpResponseSchema.parse(passed.body);
    expect(new Date(stepUpExpiresAt).getTime()).toBe(clock.getTime() + 5 * MINUTE);
    await deactivate(false).expect(200);

    advance(5 * MINUTE - STEP);
    await deactivate(true).expect(200);

    advance(STEP + 1000);
    const expired = await deactivate(false);
    expect(expired.status).toBe(403);
    expect(expired.body.error.code).toBe(ErrorCode.STEP_UP_REQUIRED);
  });

  it('ends a session after 15 idle minutes; background polling does not keep it alive', async () => {
    const { app } = build();
    const { secret } = await createSuperAdmin(db, 'dev@nwssu.test');
    const { accessToken, cookie } = await superAdminSession(app, 'dev@nwssu.test', secret);
    const overview = () => request(app).get('/api/v1/system/overview').set(bearer(accessToken));

    advance(14 * MINUTE);
    await overview().expect(200);

    advance(10 * MINUTE);
    await overview().set(BACKGROUND_REQUEST_HEADER, '1').expect(200);

    advance(6 * MINUTE);
    expect((await overview()).status).toBe(401);
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', TEST_WEB_ORIGIN)
      .set('Cookie', `orghive_rt=${cookie}`);
    expect(refresh.status).toBe(401);
  });
});

describe('the last super admin', () => {
  it('refuses self-deactivation and demoting the last active super admin', async () => {
    const { app } = build();
    const { user, secret } = await createSuperAdmin(db, 'dev@nwssu.test');
    const { accessToken } = await superAdminSession(app, 'dev@nwssu.test', secret);
    await stepUp(app, accessToken, secret).then((res) => expect(res.status).toBe(200));

    const self = await request(app)
      .patch(`/api/v1/system/users/${user.id}/status`)
      .set(bearer(accessToken))
      .send({ active: false });
    expect(self.status).toBe(409);
    expect(self.body.error.code).toBe(ErrorCode.CONFLICT);

    const last = await request(app)
      .patch(`/api/v1/system/users/${user.id}/system-role`)
      .set(bearer(accessToken))
      .send({ systemRole: 'NONE' });
    expect(last.status).toBe(409);
    expect(last.body.error.code).toBe(ErrorCode.LAST_SUPER_ADMIN);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).systemRole).toBe(
      'SUPER_ADMIN',
    );
  });

  it('demotes another super admin, audits before and after, and signs them out', async () => {
    const { app } = build();
    const { user: dev, secret } = await createSuperAdmin(db, 'dev@nwssu.test');
    const { user: other, secret: otherSecret } = await createSuperAdmin(db, 'other@nwssu.test');
    const otherSession = await superAdminSession(app, 'other@nwssu.test', otherSecret);
    const { accessToken } = await superAdminSession(app, 'dev@nwssu.test', secret);
    await stepUp(app, accessToken, secret);

    const res = await request(app)
      .patch(`/api/v1/system/users/${other.id}/system-role`)
      .set(bearer(accessToken))
      .set('User-Agent', 'console-test')
      .send({ systemRole: 'NONE' })
      .expect(200);
    expect(res.body).toMatchObject({ systemRole: 'NONE', mfaEnabledAt: null });

    const entry = await db.auditLog.findFirstOrThrow({ where: { action: 'system_role_change' } });
    expect(entry).toMatchObject({
      actorId: dev.id,
      entityId: other.id,
      userAgent: 'console-test',
      metadata: {
        before: { systemRole: 'SUPER_ADMIN', mfaEnabled: true },
        after: { systemRole: 'NONE', mfaEnabled: false },
      },
    });
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', TEST_WEB_ORIGIN)
      .set('Cookie', `orghive_rt=${otherSession.cookie}`);
    expect(refresh.status).toBe(401);
    expect(await db.recoveryCode.count({ where: { userId: other.id } })).toBe(0);

    // Now dev is the last one.
    const last = await request(app)
      .patch(`/api/v1/system/users/${dev.id}/system-role`)
      .set(bearer(accessToken))
      .send({ systemRole: 'NONE' });
    expect(last.body.error.code).toBe(ErrorCode.LAST_SUPER_ADMIN);
  });

  it('keeps one when two super admins demote each other at the same moment', async () => {
    const { app } = build();
    const a = await createSuperAdmin(db, 'a@nwssu.test');
    const b = await createSuperAdmin(db, 'b@nwssu.test');
    const sessionA = await superAdminSession(app, 'a@nwssu.test', a.secret);
    const sessionB = await superAdminSession(app, 'b@nwssu.test', b.secret);
    await stepUp(app, sessionA.accessToken, a.secret);
    await stepUp(app, sessionB.accessToken, b.secret);

    const [byA, byB] = await Promise.all([
      request(app)
        .patch(`/api/v1/system/users/${b.user.id}/system-role`)
        .set(bearer(sessionA.accessToken))
        .send({ systemRole: 'NONE' }),
      request(app)
        .patch(`/api/v1/system/users/${a.user.id}/system-role`)
        .set(bearer(sessionB.accessToken))
        .send({ systemRole: 'NONE' }),
    ]);

    expect([byA.status, byB.status].filter((status) => status === 200)).toHaveLength(1);
    expect(await db.user.count({ where: { systemRole: 'SUPER_ADMIN', disabledAt: null } })).toBe(1);
  });
});

describe('GET /system/users', () => {
  it('pages newest first and filters by role and text', async () => {
    const { app } = build();
    const { secret } = await createSuperAdmin(db, 'dev@nwssu.test');
    for (const name of ['ana', 'ben', 'cris']) await createUser(db, `${name}@nwssu.test`);
    const { accessToken } = await superAdminSession(app, 'dev@nwssu.test', secret);

    const first = systemUserListResponseSchema.parse(
      (await request(app).get('/api/v1/system/users?limit=2').set(bearer(accessToken))).body,
    );
    expect(first.items.map((u) => u.email)).toEqual(['cris@nwssu.test', 'ben@nwssu.test']);
    const second = systemUserListResponseSchema.parse(
      (
        await request(app)
          .get(`/api/v1/system/users?limit=2&cursor=${first.nextCursor}`)
          .set(bearer(accessToken))
      ).body,
    );
    expect(second.items.map((u) => u.email)).toEqual(['ana@nwssu.test', 'dev@nwssu.test']);
    expect(second.nextCursor).toBeNull();

    const supers = systemUserListResponseSchema.parse(
      (await request(app).get('/api/v1/system/users?role=SUPER_ADMIN').set(bearer(accessToken)))
        .body,
    );
    expect(supers.items.map((u) => u.email)).toEqual(['dev@nwssu.test']);
    const search = systemUserListResponseSchema.parse(
      (await request(app).get('/api/v1/system/users?q=BEN').set(bearer(accessToken))).body,
    );
    expect(search.items.map((u) => u.email)).toEqual(['ben@nwssu.test']);
  });
});
