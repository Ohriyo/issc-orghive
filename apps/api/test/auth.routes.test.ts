import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authResponseSchema, authUserSchema, ErrorCode } from '@orghive/shared';
import { hashToken } from '#src/lib/crypto';
import { createTokenService } from '#src/services/token.service';
import {
  accountFor,
  buildAuthApp,
  createUser,
  refreshCookieOf,
  setCookieHeader,
  TEST_PASSWORD,
} from './auth-fixtures';
import { buildWorld, resetDb, testDb } from './db';
import { TEST_WEB_ORIGIN } from './helpers';
import { testRedis } from './redis';

const db = testDb();
const redis = testRedis();
const EMAIL = 'officer@nwssu.test';

beforeEach(async () => {
  await redis.flushdb();
  await resetDb(db);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await redis.quit();
});

type App = ReturnType<typeof buildAuthApp>['app'];

function login(app: App, email = EMAIL, password = TEST_PASSWORD) {
  return request(app).post('/api/v1/auth/login').send({ email, password });
}

function refresh(app: App, token: string | undefined) {
  const req = request(app).post('/api/v1/auth/refresh').set('Origin', TEST_WEB_ORIGIN);
  return token ? req.set('Cookie', `orghive_rt=${token}`) : req;
}

async function signedIn(app: App) {
  const res = await login(app).expect(200);
  return {
    accessToken: authResponseSchema.parse(res.body).accessToken,
    cookie: refreshCookieOf(res)!,
  };
}

function auditActions() {
  return db.auditLog.findMany({ orderBy: { createdAt: 'asc' }, select: { action: true } });
}

describe('POST /auth/login', () => {
  it('returns an access token and sets the refresh token as a locked-down cookie', async () => {
    const user = await createUser(db, EMAIL);
    const { app } = buildAuthApp(db, redis);

    const res = await login(app, '  Officer@NWSSU.test ').expect(200);

    const body = authResponseSchema.parse(res.body);
    expect(body.user).toMatchObject({ id: user.id, email: EMAIL, mustChangePassword: false });
    expect(body.expiresIn).toBe(900);
    expect(JSON.stringify(res.body)).not.toContain(refreshCookieOf(res));
    const cookie = setCookieHeader(res);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(res.headers['cache-control']).toBe('no-store');

    const stored = await db.refreshToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.tokenHash).toBe(hashToken(refreshCookieOf(res)!));
    expect(stored.tokenHash).not.toBe(refreshCookieOf(res));
    expect(await auditActions()).toEqual([{ action: 'login' }]);
  });

  it('rejects a wrong password and an unknown email with the same answer', async () => {
    await createUser(db, EMAIL);
    const { app } = buildAuthApp(db, redis);

    const wrong = await login(app, EMAIL, 'not the password at all').expect(401);
    const unknown = await login(app, 'nobody@nwssu.test').expect(401);

    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe(ErrorCode.INVALID_CREDENTIALS);
    expect(refreshCookieOf(wrong)).toBeUndefined();
    expect(await auditActions()).toEqual([{ action: 'login_failed' }, { action: 'login_failed' }]);
  });

  it('tells a deactivated account so only after the right password', async () => {
    await createUser(db, EMAIL, { disabled: true });
    const { app } = buildAuthApp(db, redis);
    const res = await login(app).expect(403);
    expect(res.body.error).toEqual({
      code: ErrorCode.ACCOUNT_DEACTIVATED,
      message: 'This account has been deactivated. Please contact the ISSC admin.',
    });
    expect(refreshCookieOf(res)).toBeUndefined();
    const wrong = await login(app, EMAIL, 'not the password at all').expect(401);
    expect(wrong.body.error.code).toBe(ErrorCode.INVALID_CREDENTIALS);
  });

  it('validates the body', async () => {
    const { app } = buildAuthApp(db, redis);
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'nope' }).expect(400);
    expect(res.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it('reports the shared account’s organization, and why a deactivated or locked one is refused', async () => {
    const world = await buildWorld(db);
    await accountFor(db, world.orgs.jpice.id, EMAIL);
    const { app } = buildAuthApp(db, redis);
    const body = authResponseSchema.parse((await login(app).expect(200)).body);
    expect(body.user.organization).toMatchObject({ id: world.orgs.jpice.id, type: 'SBO' });

    await db.user.update({ where: { email: EMAIL }, data: { lockedAt: new Date() } });
    const locked = await login(app).expect(403);
    expect(locked.body.error.code).toBe(ErrorCode.ACCOUNT_LOCKED);
    const wrong = await login(app, EMAIL, 'not the password at all').expect(401);
    expect(wrong.body.error.message).toBe('Invalid email or password.');
  });
});

describe('login rate limits', () => {
  it('blocks an account after 5 failures in 15 minutes, even from other IPs', async () => {
    await createUser(db, EMAIL);
    const { app } = buildAuthApp(db, redis, { trustProxy: 1 });

    for (let i = 0; i < 5; i++) {
      await login(app, EMAIL, 'wrong password!!')
        .set('X-Forwarded-For', `203.0.113.${i + 1}`)
        .expect(401);
    }
    const blocked = await login(app).set('X-Forwarded-For', '198.51.100.7').expect(429);
    expect(blocked.body.error.code).toBe(ErrorCode.RATE_LIMITED);
    expect(blocked.body.error.message).toMatch(/Try again in \d+ minutes?/);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('blocks an IP after 5 failures across different accounts', async () => {
    const { app } = buildAuthApp(db, redis);
    for (let i = 0; i < 5; i++) {
      await login(app, `user${i}@nwssu.test`, 'wrong password!!').expect(401);
    }
    await login(app, 'someone-else@nwssu.test', 'wrong password!!').expect(429);
  });

  it('does not count successful logins', async () => {
    await createUser(db, EMAIL);
    const { app } = buildAuthApp(db, redis);
    for (let i = 0; i < 4; i++) await login(app, EMAIL, 'wrong password!!').expect(401);
    for (let i = 0; i < 3; i++) await login(app).expect(200);
    await login(app, EMAIL, 'wrong password!!').expect(401);
  });
});

describe('access tokens', () => {
  it('opens /me with a valid token and refuses a missing or tampered one', async () => {
    await createUser(db, EMAIL);
    const { app } = buildAuthApp(db, redis);
    const { accessToken } = await signedIn(app);

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(authUserSchema.parse(me.body).email).toBe(EMAIL);

    await request(app).get('/api/v1/auth/me').expect(401);
    const tampered = `${accessToken.slice(0, -4)}AAAA`;
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tampered}`)
      .expect(401);
  });

  it('refuses an expired access token', async () => {
    const user = await createUser(db, EMAIL);
    const { app, keys } = buildAuthApp(db, redis);

    vi.useFakeTimers({ now: Date.now() - 16 * 60 * 1000, toFake: ['Date'] });
    const { token } = await createTokenService(keys).sign({
      userId: user.id,
      passwordChangeRequired: false,
    });
    vi.useRealTimers();

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    expect(res.body.error).toEqual({
      code: ErrorCode.UNAUTHORIZED,
      message: 'Your session has expired',
    });
  });

  it('refuses a token signed with another key', async () => {
    const user = await createUser(db, EMAIL);
    const { app } = buildAuthApp(db, redis);
    const { token } = await buildAuthApp(db, redis).tokens.sign({
      userId: user.id,
      passwordChangeRequired: false,
    });
    await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    await createUser(db, EMAIL);
    const { app } = buildAuthApp(db, redis);
    const first = await signedIn(app);

    const res = await refresh(app, first.cookie).expect(200);
    const next = refreshCookieOf(res)!;

    expect(next).toBeDefined();
    expect(next).not.toBe(first.cookie);
    expect(authResponseSchema.parse(res.body).accessToken).not.toBe(first.accessToken);
    const old = await db.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashToken(first.cookie) },
    });
    const replacement = await db.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashToken(next) },
    });
    expect(old.revokedAt).not.toBeNull();
    expect(old.replacedById).toBe(replacement.id);
    expect(replacement.familyId).toBe(old.familyId);
    expect(replacement.sessionExpiresAt).toEqual(old.sessionExpiresAt);

    // The new token keeps working.
    await refresh(app, next).expect(200);
  });

  it('revokes the whole family when an already-rotated token is reused', async () => {
    const user = await createUser(db, EMAIL);
    const { app } = buildAuthApp(db, redis);
    const { cookie: stolen } = await signedIn(app);
    const rotated = refreshCookieOf(await refresh(app, stolen).expect(200))!;

    const reuse = await refresh(app, stolen).expect(401);
    expect(setCookieHeader(reuse)).toMatch(/orghive_rt=;/);

    // The legitimate holder's newer token is dead too: both must sign in again.
    await refresh(app, rotated).expect(401);
    const live = await db.refreshToken.count({ where: { userId: user.id, revokedAt: null } });
    expect(live).toBe(0);
    expect(await auditActions()).toContainEqual({ action: 'token_reuse' });
  });

  it('only lets one of two simultaneous refreshes win', async () => {
    await createUser(db, EMAIL);
    const { app } = buildAuthApp(db, redis);
    const { cookie } = await signedIn(app);

    const results = await Promise.all([refresh(app, cookie), refresh(app, cookie)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('does not let anonymous page loads on a shared IP rate-limit a signed-in user', async () => {
    await createUser(db, EMAIL);
    const { app } = buildAuthApp(db, redis);
    const { cookie } = await signedIn(app);

    // A campus of students behind one IP: every page load asks to refresh, without a cookie.
    for (let i = 0; i < 70; i++) await refresh(app, undefined).expect(401);

    await refresh(app, cookie).expect(200);
  });

  it('refuses a missing cookie, a foreign origin and an ended session', async () => {
    const user = await createUser(db, EMAIL);
    const { app } = buildAuthApp(db, redis);
    const { cookie } = await signedIn(app);

    await refresh(app, undefined).expect(401);
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `orghive_rt=${cookie}`)
      .expect(403);
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', 'https://evil.example')
      .set('Cookie', `orghive_rt=${cookie}`)
      .expect(403);

    // Past the 30-day session cap, rotation stops even though the token itself is fresh.
    await db.refreshToken.updateMany({
      where: { userId: user.id },
      data: { sessionExpiresAt: new Date(Date.now() - 1000) },
    });
    await refresh(app, cookie).expect(401);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the session, clears the cookie and records it', async () => {
    await createUser(db, EMAIL);
    const { app } = buildAuthApp(db, redis);
    const { cookie } = await signedIn(app);

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', TEST_WEB_ORIGIN)
      .set('Cookie', `orghive_rt=${cookie}`)
      .expect(204);

    expect(setCookieHeader(res)).toMatch(/orghive_rt=;.*Expires=Thu, 01 Jan 1970/);
    await refresh(app, cookie).expect(401);
    expect(await auditActions()).toContainEqual({ action: 'logout' });
    // A logged-out token is not "reuse": no family alarm.
    expect(await auditActions()).not.toContainEqual({ action: 'token_reuse' });
  });

  it('succeeds without a cookie, and refuses a foreign origin', async () => {
    const { app } = buildAuthApp(db, redis);
    await request(app).post('/api/v1/auth/logout').set('Origin', TEST_WEB_ORIGIN).expect(204);
    await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', 'https://evil.example')
      .expect(403);
  });
});

describe('password reset', () => {
  function forgot(app: App, email: string) {
    return request(app).post('/api/v1/auth/forgot-password').send({ email });
  }

  function tokenFrom(mail: { text: string }) {
    return /#token=([A-Za-z0-9_-]{43})/.exec(mail.text)?.[1];
  }

  it('answers the same for unknown emails and sends nothing', async () => {
    await createUser(db, EMAIL);
    const { app, mailer } = buildAuthApp(db, redis);
    const known = await forgot(app, EMAIL).expect(202);
    const unknown = await forgot(app, 'nobody@nwssu.test').expect(202);
    expect(unknown.body).toEqual(known.body);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe(EMAIL);
  });

  it('resets with the emailed one-time token and ends every session', async () => {
    await createUser(db, EMAIL);
    const { app, mailer } = buildAuthApp(db, redis);
    const { cookie } = await signedIn(app);

    await forgot(app, EMAIL).expect(202);
    const token = tokenFrom(mailer.sent[0]!)!;
    expect(mailer.sent[0]!.text).toContain(`${TEST_WEB_ORIGIN}/reset-password#token=`);
    expect(await db.passwordResetToken.count({ where: { tokenHash: token } })).toBe(0);

    const newPassword = 'a brand new passphrase';
    await request(app).post('/api/v1/auth/reset-password').send({ token, newPassword }).expect(204);

    await refresh(app, cookie).expect(401);
    await login(app).expect(401);
    await login(app, EMAIL, newPassword).expect(200);

    const again = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'yet another passphrase' })
      .expect(400);
    expect(again.body.error.code).toBe(ErrorCode.INVALID_RESET_TOKEN);
    expect(await auditActions()).toContainEqual({ action: 'password_reset' });
  });

  it('refuses an expired token and keeps only the latest link valid', async () => {
    await createUser(db, EMAIL);
    const { app, mailer } = buildAuthApp(db, redis);
    await forgot(app, EMAIL).expect(202);
    await forgot(app, EMAIL).expect(202);
    const [older, latest] = mailer.sent.map((m) => tokenFrom(m)!);

    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: older, newPassword: 'a brand new passphrase' })
      .expect(400);

    await db.passwordResetToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: latest, newPassword: 'a brand new passphrase' })
      .expect(400);
  });

  it('rate limits reset emails per address', async () => {
    await createUser(db, EMAIL);
    const { app } = buildAuthApp(db, redis);
    for (let i = 0; i < 5; i++) await forgot(app, EMAIL).expect(202);
    await forgot(app, EMAIL).expect(429);
  });
});

describe('forced password change', () => {
  it('allows only /me and change-password until the temporary password is replaced', async () => {
    await createUser(db, EMAIL, { mustChangePassword: true });
    const { app } = buildAuthApp(db, redis);

    const first = await login(app).expect(200);
    const { accessToken, user } = authResponseSchema.parse(first.body);
    expect(user.mustChangePassword).toBe(true);
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const changed = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'my own long passphrase' })
      .expect(200);
    expect(authResponseSchema.parse(changed.body).user.mustChangePassword).toBe(false);

    // The pre-change session is gone; the new one works.
    await refresh(app, refreshCookieOf(first)).expect(401);
    await refresh(app, refreshCookieOf(changed)).expect(200);
    expect(await auditActions()).toContainEqual({ action: 'password_change' });
  });

  it('refuses a wrong current password, a reused password and no token', async () => {
    await createUser(db, EMAIL, { mustChangePassword: true });
    const { app } = buildAuthApp(db, redis);
    const { accessToken } = await signedIn(app);
    const change = (body: object) =>
      request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body);

    const wrong = await change({
      currentPassword: 'not my password',
      newPassword: 'my own long passphrase',
    }).expect(400);
    expect(wrong.body.error.code).toBe(ErrorCode.INVALID_CREDENTIALS);
    await change({ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD }).expect(400);
    await change({ currentPassword: TEST_PASSWORD, newPassword: 'short' }).expect(400);
    await request(app)
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'my own long passphrase' })
      .expect(401);
  });
});
