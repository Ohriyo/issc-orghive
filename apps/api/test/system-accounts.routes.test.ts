import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  authResponseSchema,
  createAccountResponseSchema,
  ErrorCode,
  mfaChallengeSchema,
  notificationListResponseSchema,
  passwordResetResponseSchema,
  revealResponseSchema,
  revealStatusSchema,
  supportDocumentListSchema,
  systemUserDetailSchema,
  systemUserListResponseSchema,
  testDataPreviewSchema,
} from '@orghive/shared';
import {
  accountFor,
  buildAuthApp,
  createSuperAdmin,
  refreshCookieOf,
  TEST_PASSWORD,
  totpCode,
} from './auth-fixtures';
import { buildWorld, createTestDocument, resetDb, testDb, type World } from './db';
import { TEST_WEB_ORIGIN } from './helpers';
import { testRedis } from './redis';

/*
 * /system accounts end to end (docs/DOMAIN_RULES.md, "Accounts"): creating an organization's
 * account, the ISSC account's one-time Reveal, resets, locks, forced sign-outs, file support
 * and test data. Who gets in is checked too.
 */

const db = testDb();
const redis = testRedis();
let clock: Date;
const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};
const STEP = 30_000;
const DAY = 24 * 60 * 60 * 1000;
let world: World;

beforeEach(async () => {
  clock = new Date();
  await redis.flushdb();
  await resetDb(db);
  world = await buildWorld(db);
});
afterAll(async () => {
  await redis.quit();
});

function build(options: { emailDomains?: string[] } = {}) {
  return buildAuthApp(db, redis, { now: () => clock, ...options });
}
type Built = ReturnType<typeof build>;
type App = Built['app'];
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

function login(app: App, email: string, password = TEST_PASSWORD) {
  return request(app).post('/api/v1/auth/login').send({ email, password });
}

async function superAdmin(app: App) {
  const { secret } = await createSuperAdmin(db, 'dev@nwssu.test');
  advance(STEP);
  const first = await login(app, 'dev@nwssu.test').expect(200);
  const { challengeToken } = mfaChallengeSchema.parse(first.body);
  const res = await request(app)
    .post('/api/v1/auth/mfa/verify')
    .send({ challengeToken, code: await totpCode(secret, { at: clock }) })
    .expect(200);
  const token = authResponseSchema.parse(res.body).accessToken;
  return {
    token,
    stepUp: async () => {
      advance(STEP);
      await request(app)
        .post('/api/v1/system/step-up')
        .set(bearer(token))
        .send({ code: await totpCode(secret, { at: clock }) })
        .expect(200);
    },
  };
}

/** Signs an organization's world account in with TEST_PASSWORD. */
async function orgToken(app: App, organizationId: string, email: string) {
  await accountFor(db, organizationId, email);
  const res = await login(app, email).expect(200);
  return authResponseSchema.parse(res.body).accessToken;
}

/** A CEA SBO with no account yet. */
function iecep() {
  return db.organization.create({
    data: {
      type: 'SBO',
      slug: 'iecep',
      acronym: 'IECEP',
      name: 'Institute of Electronics Engineers of the Philippines',
      parentId: world.orgs.cscCea.id,
      collegeId: world.colleges.cea.id,
    },
  });
}

const OFFICER = { name: 'Rosa Lim', position: 'President', email: 'rosa@nwssu.test' };

function createBody(slug: string, email = `${slug}@nwssu.test`) {
  return { organization: { kind: 'existing', slug }, email, officerInCharge: OFFICER };
}

describe('who may use the /system account routes', () => {
  const routes: [string, string, object?][] = [
    ['get', '/api/v1/system/users/00000000-0000-7000-8000-000000000000'],
    ['post', '/api/v1/system/accounts', {}],
    ['get', '/api/v1/system/organizations'],
    ['patch', '/api/v1/system/users/00000000-0000-7000-8000-000000000000', {}],
    ['patch', '/api/v1/system/users/00000000-0000-7000-8000-000000000000/lock', {}],
    ['post', '/api/v1/system/users/00000000-0000-7000-8000-000000000000/password-reset'],
    ['post', '/api/v1/system/users/00000000-0000-7000-8000-000000000000/sign-out'],
    ['get', '/api/v1/system/organizations/jpice/documents'],
    ['post', '/api/v1/system/documents/00000000-0000-7000-8000-000000000000/rescan'],
    ['post', '/api/v1/system/documents/00000000-0000-7000-8000-000000000000/restore'],
    ['get', '/api/v1/system/test-data'],
    ['post', '/api/v1/system/test-data/delete', { expectedCount: 1 }],
  ];

  it('401s signed out, 403s every organization account (the ISSC included)', async () => {
    const { app } = build();
    const issc = await orgToken(app, world.orgs.issc.id, 'issc@test.local');
    const jpice = await orgToken(app, world.orgs.jpice.id, 'jpice@test.local');
    for (const [method, path, body] of routes) {
      const call = (token?: string) => {
        let req = (request(app) as unknown as Record<string, (p: string) => request.Test>)[method]!(
          path,
        );
        if (token) req = req.set(bearer(token));
        return body ? req.send(body) : req;
      };
      expect((await call()).status, `${method} ${path} signed out`).toBe(401);
      expect((await call(issc)).status, `${method} ${path} as the ISSC`).toBe(403);
      expect((await call(jpice)).status, `${method} ${path} as JPICE`).toBe(403);
    }
  });

  it('needs a fresh step-up code for resets, forced sign-outs and deleting test data', async () => {
    const { app } = build();
    const { token } = await superAdmin(app);
    const id = world.users.officer.id;
    for (const [path, body] of [
      [`/api/v1/system/users/${id}/password-reset`, undefined],
      [`/api/v1/system/users/${id}/sign-out`, undefined],
      ['/api/v1/system/test-data/delete', { expectedCount: 1 }],
    ] as const) {
      const res = await request(app).post(path).set(bearer(token)).send(body);
      expect(res.status, path).toBe(403);
      expect((res.body as { error: { code: string } }).error.code).toBe(ErrorCode.STEP_UP_REQUIRED);
    }
  });
});

describe('creating an account, and the ISSC account’s one-time Reveal', () => {
  it('delivers the temporary password to the ISSC once; the account must change it', async () => {
    const { app } = build();
    const { token } = await superAdmin(app);
    const org = await iecep();

    const res = await request(app)
      .post('/api/v1/system/accounts')
      .set(bearer(token))
      .send({ ...createBody('iecep'), termEnd: '2027-07-31' })
      .expect(201);
    const created = createAccountResponseSchema.parse(res.body);
    expect(created.delivery.kind).toBe('reveal');
    // The super admin never sees it.
    expect(JSON.stringify(res.body)).not.toMatch(/temporaryPassword/);
    expect(created.account).toMatchObject({
      email: 'iecep@nwssu.test',
      name: 'IECEP',
      mustChangePassword: true,
      organization: { slug: 'iecep', type: 'SBO', college: 'CEA' },
      officerInCharge: OFFICER,
    });

    // The ISSC account's notification carries the Reveal; its text never has the password.
    const issc = await orgToken(app, world.orgs.issc.id, 'issc@test.local');
    const list = notificationListResponseSchema.parse(
      (await request(app).get('/api/v1/me/notifications').set(bearer(issc)).expect(200)).body,
    );
    const note = list.items.find((n) => n.kind === 'password_reveal')!;
    expect(note).toMatchObject({ title: 'New account for IECEP' });
    const revealId = note.revealId!;

    // Nobody else can open it, the super admin included.
    const jpice = await orgToken(app, world.orgs.jpice.id, 'jpice@test.local');
    await request(app).post(`/api/v1/me/reveals/${revealId}/reveal`).set(bearer(jpice)).expect(404);
    await request(app).post(`/api/v1/me/reveals/${revealId}/reveal`).set(bearer(token)).expect(404);

    const status = revealStatusSchema.parse(
      (await request(app).get(`/api/v1/me/reveals/${revealId}`).set(bearer(issc)).expect(200)).body,
    );
    expect(status).toMatchObject({
      status: 'available',
      purpose: 'account_created',
      entryCount: 1,
    });

    const revealed = await request(app)
      .post(`/api/v1/me/reveals/${revealId}/reveal`)
      .set(bearer(issc))
      .expect(200);
    expect(revealed.headers['cache-control']).toBe('private, no-store');
    const [entry] = revealResponseSchema.parse(revealed.body).entries;
    expect(entry).toMatchObject({
      email: 'iecep@nwssu.test',
      organization: { acronym: 'IECEP', type: 'SBO' },
      officerInCharge: OFFICER,
    });
    expect(entry!.temporaryPassword).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
    expect(note.body).not.toContain(entry!.temporaryPassword);

    // Once only: the copy is erased.
    const again = await request(app)
      .post(`/api/v1/me/reveals/${revealId}/reveal`)
      .set(bearer(issc))
      .expect(410);
    expect((again.body as { error: { code: string } }).error.code).toBe(ErrorCode.REVEAL_GONE);
    const row = await db.passwordReveal.findUniqueOrThrow({ where: { id: revealId } });
    expect(row.sealed).toBeNull();
    expect(row.revealedAt).not.toBeNull();

    // The new account signs in with it, and must change it first.
    const signIn = authResponseSchema.parse(
      (await login(app, 'iecep@nwssu.test', entry!.temporaryPassword).expect(200)).body,
    );
    expect(signIn.user.mustChangePassword).toBe(true);
    await request(app).get('/api/v1/me/dashboard').set(bearer(signIn.accessToken)).expect(403);

    const account = await db.user.findUniqueOrThrow({
      where: { email: 'iecep@nwssu.test' },
      include: { officerTerms: true },
    });
    expect(account.passwordHash).not.toContain(entry!.temporaryPassword);
    expect(account.officerTerms).toHaveLength(1);
    expect(account.officerTerms[0]!.termEnd?.toISOString().slice(0, 10)).toBe('2027-07-31');
    expect(account.organizationId).toBe(org.id);

    const actions = (
      await db.auditLog.findMany({
        where: { action: { in: ['account_create', 'password_reveal'] } },
        orderBy: { id: 'asc' },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(['account_create', 'password_reveal']);
  });

  it('creates a new SBO with its account; it shows in its college at once', async () => {
    const { app } = build();
    const { token } = await superAdmin(app);
    await request(app)
      .post('/api/v1/system/accounts')
      .set(bearer(token))
      .send({
        organization: {
          kind: 'new',
          type: 'SBO',
          collegeSlug: 'cea',
          slug: 'uapsa',
          acronym: 'UAPSA',
          name: 'United Architects of the Philippines Student Auxiliary',
        },
        email: 'uapsa@nwssu.test',
        officerInCharge: OFFICER,
      })
      .expect(201);
    const tree = (
      await request(app).get('/api/v1/system/organizations').set(bearer(token)).expect(200)
    ).body as { colleges: { slug: string; sbos: { slug: string; hasAccount: boolean }[] }[] };
    const cea = tree.colleges.find((c) => c.slug === 'cea')!;
    expect(cea.sbos).toContainEqual(expect.objectContaining({ slug: 'uapsa', hasAccount: true }));
    const org = await db.organization.findUniqueOrThrow({ where: { slug: 'uapsa' } });
    expect(org.parentId).toBe(world.orgs.cscCea.id);
  });

  it('shows the ISSC account’s own password once to the super admin, and stores no copy', async () => {
    const { app } = build();
    const { token } = await superAdmin(app);
    await db.user.update({ where: { id: world.users.issc.id }, data: { disabledAt: new Date() } });
    const res = await request(app)
      .post('/api/v1/system/accounts')
      .set(bearer(token))
      .send(createBody('issc', 'issc-new@nwssu.test'))
      .expect(201);
    const { delivery } = createAccountResponseSchema.parse(res.body);
    if (delivery.kind !== 'shown_once') throw new Error('expected the password in the response');
    expect(await db.passwordReveal.count()).toBe(0);
    await login(app, 'issc-new@nwssu.test', delivery.temporaryPassword).expect(200);
  });

  it('refuses a taken email, an organization with an account, an unknown one, a foreign domain', async () => {
    const { app } = build({ emailDomains: ['nwssu.test'] });
    const { token } = await superAdmin(app);
    await iecep();
    const create = (body: object) =>
      request(app).post('/api/v1/system/accounts').set(bearer(token)).send(body);
    await create(createBody('jpice', 'jpice2@nwssu.test')).expect(409);
    await create(createBody('iecep', 'dev@nwssu.test')).expect(409);
    await create(createBody('nope')).expect(404);
    await create(createBody('iecep', 'iecep@gmail.com')).expect(400);
    await create({ ...createBody('iecep'), officerInCharge: { name: 'R' } }).expect(400);
    expect(
      await db.user.count({
        where: { organizationId: { not: null }, email: { startsWith: 'iecep' } },
      }),
    ).toBe(0);
  });

  it('refuses while there is no ISSC account to receive the password', async () => {
    const { app } = build();
    const { token } = await superAdmin(app);
    await iecep();
    await db.user.update({ where: { id: world.users.issc.id }, data: { lockedAt: new Date() } });
    const res = await request(app)
      .post('/api/v1/system/accounts')
      .set(bearer(token))
      .send(createBody('iecep'))
      .expect(409);
    expect((res.body as { error: { message: string } }).error.message).toMatch(
      /ISSC account first/,
    );
    expect(await db.user.count({ where: { email: 'iecep@nwssu.test' } })).toBe(0);
  });

  it('expires an unrevealed password after 7 days and erases it', async () => {
    const built = build();
    const { app } = built;
    const { token } = await superAdmin(app);
    await iecep();
    await request(app)
      .post('/api/v1/system/accounts')
      .set(bearer(token))
      .send(createBody('iecep'))
      .expect(201);
    const reveal = await db.passwordReveal.findFirstOrThrow();
    expect(reveal.expiresAt.getTime() - clock.getTime()).toBe(7 * DAY);

    advance(7 * DAY + 1);
    const issc = await orgToken(app, world.orgs.issc.id, 'issc@test.local');
    const status = revealStatusSchema.parse(
      (await request(app).get(`/api/v1/me/reveals/${reveal.id}`).set(bearer(issc))).body,
    );
    expect(status.status).toBe('expired');
    await request(app).post(`/api/v1/me/reveals/${reveal.id}/reveal`).set(bearer(issc)).expect(410);
  });
});

describe('resets, sign-outs, locks and deactivation end every session at once', () => {
  it('a reset sends a new password to the Reveal and ends the account’s sessions', async () => {
    const { app } = build();
    const { token, stepUp } = await superAdmin(app);
    const jpice = await orgToken(app, world.orgs.jpice.id, 'jpice@test.local');
    await request(app).get('/api/v1/me/notifications').set(bearer(jpice)).expect(200);

    await stepUp();
    const res = await request(app)
      .post(`/api/v1/system/users/${world.users.officer.id}/password-reset`)
      .set(bearer(token))
      .expect(200);
    const reset = passwordResetResponseSchema.parse(res.body);
    expect(reset.delivery.kind).toBe('reveal');
    expect(reset.account.mustChangePassword).toBe(true);

    // The live access token stops working at once, and the old password too.
    await request(app).get('/api/v1/me/notifications').set(bearer(jpice)).expect(401);
    await login(app, 'jpice@test.local').expect(401);
    expect(
      await db.refreshToken.count({ where: { userId: world.users.officer.id, revokedAt: null } }),
    ).toBe(0);

    const reveal = await db.passwordReveal.findFirstOrThrow({
      where: { purpose: 'password_reset' },
    });
    const issc = await orgToken(app, world.orgs.issc.id, 'issc@test.local');
    const { entries } = revealResponseSchema.parse(
      (
        await request(app)
          .post(`/api/v1/me/reveals/${reveal.id}/reveal`)
          .set(bearer(issc))
          .expect(200)
      ).body,
    );
    const fresh = authResponseSchema.parse(
      (await login(app, 'jpice@test.local', entries[0]!.temporaryPassword).expect(200)).body,
    );
    // A sign-in right after the reset works (it is newer than the revocation).
    await request(app).get('/api/v1/auth/me').set(bearer(fresh.accessToken)).expect(200);
    expect(await db.auditLog.count({ where: { action: 'password_reset_issued' } })).toBe(1);
  });

  it('refuses resets for super admins and deactivated accounts', async () => {
    const { app } = build();
    const { token, stepUp } = await superAdmin(app);
    const dev = await db.user.findUniqueOrThrow({ where: { email: 'dev@nwssu.test' } });
    await stepUp();
    await request(app)
      .post(`/api/v1/system/users/${dev.id}/password-reset`)
      .set(bearer(token))
      .expect(409);
    await db.user.update({ where: { id: world.users.psme.id }, data: { disabledAt: new Date() } });
    await request(app)
      .post(`/api/v1/system/users/${world.users.psme.id}/password-reset`)
      .set(bearer(token))
      .expect(409);
  });

  it('a forced sign-out ends sessions; never your own', async () => {
    const { app } = build();
    const { token, stepUp } = await superAdmin(app);
    await accountFor(db, world.orgs.jpice.id, 'jpice@test.local');
    const signedIn = await login(app, 'jpice@test.local').expect(200);
    const access = authResponseSchema.parse(signedIn.body).accessToken;
    const cookie = refreshCookieOf(signedIn)!;

    await stepUp();
    await request(app)
      .post(`/api/v1/system/users/${world.users.officer.id}/sign-out`)
      .set(bearer(token))
      .expect(200);
    await request(app).get('/api/v1/me/notifications').set(bearer(access)).expect(401);
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', TEST_WEB_ORIGIN)
      .set('Cookie', `orghive_rt=${cookie}`)
      .expect(401);
    // The account can sign in again.
    await login(app, 'jpice@test.local').expect(200);

    const dev = await db.user.findUniqueOrThrow({ where: { email: 'dev@nwssu.test' } });
    await request(app)
      .post(`/api/v1/system/users/${dev.id}/sign-out`)
      .set(bearer(token))
      .expect(409);
    expect(await db.auditLog.count({ where: { action: 'sessions_revoke' } })).toBe(1);
  });

  it('locks with a reason (sessions end, sign-in says locked) and unlocks', async () => {
    const { app } = build();
    const { token } = await superAdmin(app);
    const jpice = await orgToken(app, world.orgs.jpice.id, 'jpice@test.local');
    const lock = (body: object) =>
      request(app)
        .patch(`/api/v1/system/users/${world.users.officer.id}/lock`)
        .set(bearer(token))
        .send(body);

    await lock({ locked: true }).expect(400);
    const locked = (await lock({ locked: true, reason: 'Suspicious sign-ins' }).expect(200))
      .body as {
      lockedAt: string | null;
      lockReason: string;
    };
    expect(locked).toMatchObject({ lockReason: 'Suspicious sign-ins' });
    await request(app).get('/api/v1/me/notifications').set(bearer(jpice)).expect(401);
    const refused = await login(app, 'jpice@test.local').expect(403);
    expect((refused.body as { error: { code: string } }).error.code).toBe(ErrorCode.ACCOUNT_LOCKED);
    await lock({ locked: true, reason: 'Again' }).expect(409);

    await lock({ locked: false }).expect(200);
    await login(app, 'jpice@test.local').expect(200);
    const dev = await db.user.findUniqueOrThrow({ where: { email: 'dev@nwssu.test' } });
    await request(app)
      .patch(`/api/v1/system/users/${dev.id}/lock`)
      .set(bearer(token))
      .send({ locked: true, reason: 'Testing' })
      .expect(409);
    expect(
      (
        await db.auditLog.findMany({
          where: { action: { in: ['account_lock', 'account_unlock'] } },
        })
      ).map((a) => a.action),
    ).toEqual(['account_lock', 'account_unlock']);
  });

  it('deactivation ends the live token; reactivating beside another active account is refused', async () => {
    const { app } = build();
    const { token, stepUp } = await superAdmin(app);
    const jpice = await orgToken(app, world.orgs.jpice.id, 'jpice@test.local');
    await stepUp();
    await request(app)
      .patch(`/api/v1/system/users/${world.users.officer.id}/status`)
      .set(bearer(token))
      .send({ active: false })
      .expect(200);
    await request(app).get('/api/v1/me/notifications').set(bearer(jpice)).expect(401);

    // A replacement account for JPICE, then the old one cannot come back beside it.
    await db.user.create({
      data: {
        email: 'jpice-new@nwssu.test',
        name: 'JPICE',
        passwordHash: 'x',
        organizationId: world.orgs.jpice.id,
      },
    });
    await request(app)
      .patch(`/api/v1/system/users/${world.users.officer.id}/status`)
      .set(bearer(token))
      .send({ active: true })
      .expect(409);
  });
});

describe('editing, listing and the account page', () => {
  it('corrects details; a new officer name starts a new term; audited before and after', async () => {
    const { app } = build({ emailDomains: ['nwssu.test', 'test.local'] });
    const { token } = await superAdmin(app);
    const id = world.users.officer.id;
    const patch = (body: object) =>
      request(app).patch(`/api/v1/system/users/${id}`).set(bearer(token)).send(body);

    await patch({}).expect(400);
    await patch({ email: 'csc-cea@test.local' }).expect(409);
    await patch({ email: 'jpice@gmail.com' }).expect(400);
    await patch({ email: 'jpice@nwssu.test', officerInCharge: OFFICER }).expect(200);
    await patch({
      officerInCharge: { ...OFFICER, position: 'Chairperson' },
      termEnd: '2027-07-31',
    }).expect(200);

    const detail = systemUserDetailSchema.parse(
      (await request(app).get(`/api/v1/system/users/${id}`).set(bearer(token)).expect(200)).body,
    );
    expect(detail.account).toMatchObject({
      email: 'jpice@nwssu.test',
      officerInCharge: { name: 'Rosa Lim', position: 'Chairperson' },
    });
    expect(detail.terms[0]).toMatchObject({
      officerName: 'Rosa Lim',
      termEnd: '2027-07-31',
      endedAt: null,
    });
    expect(detail.terms.length).toBe(2);
    expect(detail.terms[1]!.endedAt).not.toBeNull();
    expect(detail.audit.map((a) => a.action)).toContain('account_update');
    const update = await db.auditLog.findFirstOrThrow({ where: { action: 'account_update' } });
    expect(update.metadata).toMatchObject({
      before: { email: 'jpice@test.local' },
      after: { email: 'jpice@nwssu.test' },
    });
  });

  it('shows sign-ins, sessions and the audit trail on the account page', async () => {
    const { app } = build();
    const { token } = await superAdmin(app);
    await accountFor(db, world.orgs.jpice.id, 'jpice@test.local');
    await login(app, 'jpice@test.local', 'wrong password!!').expect(401);
    await login(app, 'jpice@test.local').expect(200);
    const detail = systemUserDetailSchema.parse(
      (
        await request(app)
          .get(`/api/v1/system/users/${world.users.officer.id}`)
          .set(bearer(token))
          .expect(200)
      ).body,
    );
    expect(detail.logins.map((l) => l.succeeded)).toEqual([true, false]);
    expect(detail.sessions).toHaveLength(1);
    await request(app)
      .get('/api/v1/system/users/00000000-0000-7000-8000-000000000000')
      .set(bearer(token))
      .expect(404);
  });

  it('filters by organization type, college, organization and status', async () => {
    const { app } = build();
    const { token } = await superAdmin(app);
    await db.user.update({
      where: { id: world.users.psme.id },
      data: { lockedAt: new Date(), lockReason: 'x' },
    });
    await db.user.update({
      where: { id: world.users.cscCat.id },
      data: { mustChangePassword: true },
    });
    const emails = async (query: string) =>
      systemUserListResponseSchema
        .parse(
          (await request(app).get(`/api/v1/system/users?${query}`).set(bearer(token)).expect(200))
            .body,
        )
        .items.map((u) => u.email)
        .sort();
    expect(await emails('type=SBO')).toEqual(['jpice@test.local', 'psme@test.local']);
    expect(await emails('type=CSC&college=cea')).toEqual(['csc-cea@test.local']);
    expect(await emails('organization=jpice')).toEqual(['jpice@test.local']);
    expect(await emails('status=locked')).toEqual(['psme@test.local']);
    expect(await emails('status=must_change&type=CSC')).toEqual(['csc-cat@test.local']);
    expect(await emails('q=psme')).toEqual(['psme@test.local']);
    expect(await emails('lastLogin=7d')).toEqual(['dev@nwssu.test']);
    await request(app).get('/api/v1/system/users?status=gone').set(bearer(token)).expect(400);
  });
});

describe('file support and test data', () => {
  it('lists file details without private titles, storage keys or links', async () => {
    const { app } = build();
    const { token } = await superAdmin(app);
    const res = await request(app)
      .get('/api/v1/system/organizations/jpice/documents')
      .set(bearer(token))
      .expect(200);
    const list = supportDocumentListSchema.parse(res.body);
    const byId = new Map(list.items.map((d) => [d.id, d]));
    expect(byId.get(world.docs.jpicePrivate.id)).toMatchObject({
      title: null,
      visibility: 'private',
    });
    expect(byId.get(world.docs.jpicePublic.id)?.title).toBe('JPICE accomplishment report');
    expect(byId.has(world.docs.jpiceDeleted.id)).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/storageKey|test\/|draft resolution/);
    await request(app)
      .get('/api/v1/system/organizations/nope/documents')
      .set(bearer(token))
      .expect(404);
  });

  it('runs a stuck scan again and restores an archived file, audited', async () => {
    const built = build();
    const { app, queued } = built;
    const { token } = await superAdmin(app);
    const scanning = await db.document.findUniqueOrThrow({
      where: { id: world.docs.jpiceScanning.id },
    });
    await request(app)
      .post(`/api/v1/system/documents/${scanning.id}/rescan`)
      .set(bearer(token))
      .expect(204);
    expect(queued.processing).toEqual([scanning.currentVersionId]);
    await request(app)
      .post(`/api/v1/system/documents/${world.docs.jpicePublic.id}/rescan`)
      .set(bearer(token))
      .expect(409);

    await request(app)
      .post(`/api/v1/system/documents/${world.docs.jpiceArchived.id}/restore`)
      .set(bearer(token))
      .expect(204);
    const restored = await db.document.findUniqueOrThrow({
      where: { id: world.docs.jpiceArchived.id },
    });
    expect(restored.status).toBe('available');
    await request(app)
      .post(`/api/v1/system/documents/${world.docs.jpicePublic.id}/restore`)
      .set(bearer(token))
      .expect(409);
    expect(
      (
        await db.auditLog.findMany({ where: { action: { in: ['support_rescan', 'restore'] } } })
      ).map((a) => [a.action, a.metadata]),
    ).toEqual([
      ['support_rescan', { versionId: scanning.currentVersionId }],
      ['restore', { support: true }],
    ]);
  });

  it('previews test data, then deletes exactly what was previewed, after a step-up', async () => {
    const { app } = build();
    const { token, stepUp } = await superAdmin(app);
    const flagged = [world.docs.jpicePrivate.id, world.docs.psmePrivate.id];
    await db.document.updateMany({ where: { id: { in: flagged } }, data: { isTestData: true } });
    // Already deleted test data is not listed again.
    await createTestDocument(db, {
      organizationId: world.orgs.jpice.id,
      typeId: world.types.proposal.id,
      title: 'Old',
      status: 'available',
      createdById: world.users.officer.id,
      deleted: true,
    }).then((d) => db.document.update({ where: { id: d.id }, data: { isTestData: true } }));

    const preview = testDataPreviewSchema.parse(
      (await request(app).get('/api/v1/system/test-data').set(bearer(token)).expect(200)).body,
    );
    expect(preview.total).toBe(2);
    expect(preview.items.map((i) => i.organization.acronym).sort()).toEqual(['JPICE', 'PSME']);

    await stepUp();
    const del = (expectedCount: number) =>
      request(app)
        .post('/api/v1/system/test-data/delete')
        .set(bearer(token))
        .send({ expectedCount });
    await del(3).expect(409);
    expect(await db.document.count({ where: { id: { in: flagged }, deletedAt: null } })).toBe(2);
    expect((await del(2).expect(200)).body).toEqual({ deleted: 2 });
    expect(await db.document.count({ where: { id: { in: flagged }, deletedAt: null } })).toBe(0);
    expect(
      await db.auditLog.count({ where: { action: 'delete', entityId: { in: flagged } } }),
    ).toBe(2);
  });
});
