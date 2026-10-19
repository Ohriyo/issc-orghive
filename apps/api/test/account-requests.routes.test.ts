import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  accountRequestCountSchema,
  adminOrganizationTreeSchema,
  authResponseSchema,
  createAccountResponseSchema,
  mfaChallengeSchema,
  notificationListResponseSchema,
  revealResponseSchema,
  systemAccountRequestListSchema,
  systemAccountRequestSchema,
} from '@orghive/shared';
import {
  accountFor,
  buildAuthApp,
  createSuperAdmin,
  TEST_PASSWORD,
  totpCode,
} from './auth-fixtures';
import { buildWorld, resetDb, testDb, type World } from './db';
import { testRedis } from './redis';

/*
 * Account requests end to end (docs/DOMAIN_RULES.md, "Accounts"): the ISSC account asks from
 * /admin, the super admins are emailed, the super admin creates the account (its password goes
 * to the ISSC's one-time Reveal) or declines it with a reason.
 */

const db = testDb();
const redis = testRedis();
let clock: Date;
let world: World;

beforeEach(async () => {
  clock = new Date();
  await redis.flushdb();
  await resetDb(db);
  world = await buildWorld(db);
  await db.organization.create({
    data: {
      type: 'SBO',
      slug: 'iecep',
      acronym: 'IECEP',
      name: 'Institute of Electronics Engineers of the Philippines',
      parentId: world.orgs.cscCea.id,
      collegeId: world.colleges.cea.id,
    },
  });
});
afterAll(async () => {
  await redis.quit();
});

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const OFFICER = { name: 'Rosa Lim', position: 'President', email: 'rosa@nwssu.test' };
const ASK = {
  accountEmail: 'iecep@nwssu.test',
  officerInCharge: OFFICER,
  note: 'New SBO this year',
};

function build() {
  return buildAuthApp(db, redis, { now: () => clock });
}
type App = ReturnType<typeof build>['app'];

function login(app: App, email: string, password = TEST_PASSWORD) {
  return request(app).post('/api/v1/auth/login').send({ email, password });
}

async function orgToken(app: App, organizationId: string, email: string) {
  await accountFor(db, organizationId, email);
  return authResponseSchema.parse((await login(app, email).expect(200)).body).accessToken;
}

async function superAdmin(app: App) {
  const { secret } = await createSuperAdmin(db, 'dev@nwssu.test');
  clock = new Date(clock.getTime() + 30_000);
  const first = await login(app, 'dev@nwssu.test').expect(200);
  const { challengeToken } = mfaChallengeSchema.parse(first.body);
  const res = await request(app)
    .post('/api/v1/auth/mfa/verify')
    .send({ challengeToken, code: await totpCode(secret, { at: clock }) })
    .expect(200);
  return authResponseSchema.parse(res.body).accessToken;
}

const ask = (app: App, token: string, slug = 'iecep', body: object = ASK) =>
  request(app)
    .post(`/api/v1/admin/organizations/${slug}/account-request`)
    .set(bearer(token))
    .send(body);

describe('who may request and decide', () => {
  it('only the ISSC account requests; only a super admin sees and decides', async () => {
    const { app } = build();
    const jpice = await orgToken(app, world.orgs.jpice.id, 'jpice@test.local');
    const issc = await orgToken(app, world.orgs.issc.id, 'issc@test.local');
    const dev = await superAdmin(app);
    await request(app)
      .post('/api/v1/admin/organizations/iecep/account-request')
      .send(ASK)
      .expect(401);
    await ask(app, jpice).expect(403);
    await ask(app, dev).expect(403);
    for (const path of [
      '/api/v1/system/account-requests',
      '/api/v1/system/account-requests/count',
    ]) {
      await request(app).get(path).expect(401);
      await request(app).get(path).set(bearer(issc)).expect(403);
      await request(app).get(path).set(bearer(jpice)).expect(403);
    }
    await request(app)
      .post('/api/v1/system/account-requests/00000000-0000-7000-8000-000000000000/decline')
      .set(bearer(issc))
      .send({ reason: 'Not needed' })
      .expect(403);
    await request(app).get('/api/v1/system/account-requests').set(bearer(dev)).expect(200);
  });
});

describe('request → create → reveal once → forced password change', () => {
  it('runs the whole flow, audited at each step', async () => {
    const { app, mailer } = build();
    const issc = await orgToken(app, world.orgs.issc.id, 'issc@test.local');
    const dev = await superAdmin(app);

    const asked = await ask(app, issc).expect(201);
    expect(asked.body).toMatchObject({ status: 'requested', declineReason: null });
    // Every active super admin is emailed (sent after the response).
    await expect.poll(() => mailer.sent.filter((m) => m.subject.includes('IECEP')).length).toBe(1);
    expect(mailer.sent.find((m) => m.subject.includes('IECEP'))?.to).toBe('dev@nwssu.test');

    // /admin shows it on the organization's row.
    const tree = adminOrganizationTreeSchema.parse(
      (await request(app).get('/api/v1/admin/organizations').set(bearer(issc)).expect(200)).body,
    );
    const row = tree.colleges.find((c) => c.slug === 'cea')!.sbos.find((o) => o.slug === 'iecep')!;
    expect(row).toMatchObject({ hasAccount: false, accountRequest: { status: 'requested' } });

    // The super admin's queue and its count.
    expect(
      accountRequestCountSchema.parse(
        (
          await request(app)
            .get('/api/v1/system/account-requests/count')
            .set(bearer(dev))
            .expect(200)
        ).body,
      ),
    ).toEqual({ open: 1 });
    const queue = systemAccountRequestListSchema.parse(
      (await request(app).get('/api/v1/system/account-requests').set(bearer(dev)).expect(200)).body,
    );
    const item = queue.items[0]!;
    expect(item).toMatchObject({
      organization: { slug: 'iecep', collegeSlug: 'cea', hasAccount: false },
      accountEmail: 'iecep@nwssu.test',
      officerInCharge: OFFICER,
      note: 'New SBO this year',
      requestedBy: { email: 'issc@test.local' },
    });

    // Created from the request: it is fulfilled, and the ISSC gets the Reveal.
    const created = createAccountResponseSchema.parse(
      (
        await request(app)
          .post('/api/v1/system/accounts')
          .set(bearer(dev))
          .send({
            organization: { kind: 'existing', slug: 'iecep' },
            email: item.accountEmail,
            officerInCharge: item.officerInCharge,
            requestId: item.id,
          })
          .expect(201)
      ).body,
    );
    expect(created.delivery.kind).toBe('reveal');
    const after = systemAccountRequestSchema.parse(
      (
        await request(app)
          .get(`/api/v1/system/account-requests/${item.id}`)
          .set(bearer(dev))
          .expect(200)
      ).body,
    );
    expect(after).toMatchObject({ status: 'created', createdAccountId: created.account.id });

    const notes = notificationListResponseSchema.parse(
      (await request(app).get('/api/v1/me/notifications').set(bearer(issc)).expect(200)).body,
    );
    const note = notes.items.find((n) => n.kind === 'password_reveal')!;
    expect(note.title).toBe('The account you requested for IECEP is ready');
    const { entries } = revealResponseSchema.parse(
      (
        await request(app)
          .post(`/api/v1/me/reveals/${note.revealId}/reveal`)
          .set(bearer(issc))
          .expect(200)
      ).body,
    );
    await request(app)
      .post(`/api/v1/me/reveals/${note.revealId}/reveal`)
      .set(bearer(issc))
      .expect(410);
    const signIn = authResponseSchema.parse(
      (await login(app, 'iecep@nwssu.test', entries[0]!.temporaryPassword).expect(200)).body,
    );
    expect(signIn.user.mustChangePassword).toBe(true);

    // Now it has an account: no further request.
    await ask(app, issc).expect(409);
    const audit = await db.auditLog.findMany({
      where: { action: { in: ['account_request', 'account_create', 'password_reveal'] } },
      orderBy: { id: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual([
      'account_request',
      'account_create',
      'password_reveal',
    ]);
    expect(audit[1]!.metadata).toMatchObject({ requestId: item.id });
  });
});

describe('refusals and declines', () => {
  it('refuses a second open request, and one for an organization with an account', async () => {
    const { app } = build();
    const issc = await orgToken(app, world.orgs.issc.id, 'issc@test.local');
    await ask(app, issc).expect(201);
    const again = await ask(app, issc).expect(409);
    expect((again.body as { error: { message: string } }).error.message).toMatch(
      /already requested/,
    );
    await ask(app, issc, 'jpice').expect(409);
    await ask(app, issc, 'nope').expect(404);
    await ask(app, issc, 'iecep', { ...ASK, accountEmail: 'not-an-email' }).expect(400);
    expect(await db.accountRequest.count()).toBe(1);
  });

  it('declines with a reason, tells the ISSC, and lets it ask again', async () => {
    const { app } = build();
    const issc = await orgToken(app, world.orgs.issc.id, 'issc@test.local');
    const dev = await superAdmin(app);
    const id = ((await ask(app, issc).expect(201)).body as { id: string }).id;
    const decline = (reason: string) =>
      request(app)
        .post(`/api/v1/system/account-requests/${id}/decline`)
        .set(bearer(dev))
        .send({ reason });

    await decline('no').expect(400);
    const declined = systemAccountRequestSchema.parse(
      (await decline('Use the official IECEP email address').expect(200)).body,
    );
    expect(declined).toMatchObject({
      status: 'declined',
      declineReason: 'Use the official IECEP email address',
    });
    await decline('Again, no thanks').expect(409);

    const notes = notificationListResponseSchema.parse(
      (await request(app).get('/api/v1/me/notifications').set(bearer(issc)).expect(200)).body,
    );
    expect(notes.items[0]).toMatchObject({
      kind: 'account_request_declined',
      title: 'Account request for IECEP declined',
    });
    expect(notes.items[0]!.body).toContain('Use the official IECEP email address');
    // A declined request cannot be used to create the account.
    await request(app)
      .post('/api/v1/system/accounts')
      .set(bearer(dev))
      .send({
        organization: { kind: 'existing', slug: 'iecep' },
        email: 'iecep@nwssu.test',
        officerInCharge: OFFICER,
        requestId: id,
      })
      .expect(409);

    await ask(app, issc).expect(201);
    expect(
      await db.auditLog.count({ where: { action: 'account_request_decline', entityId: id } }),
    ).toBe(1);
  });

  it('refuses to fulfil a request with another organization’s account', async () => {
    const { app } = build();
    const issc = await orgToken(app, world.orgs.issc.id, 'issc@test.local');
    const dev = await superAdmin(app);
    const id = ((await ask(app, issc).expect(201)).body as { id: string }).id;
    await db.organization.create({
      data: {
        type: 'SBO',
        slug: 'psme2',
        acronym: 'PSME2',
        name: 'Another SBO',
        parentId: world.orgs.cscCea.id,
        collegeId: world.colleges.cea.id,
      },
    });
    await request(app)
      .post('/api/v1/system/accounts')
      .set(bearer(dev))
      .send({
        organization: { kind: 'existing', slug: 'psme2' },
        email: 'psme2@nwssu.test',
        officerInCharge: OFFICER,
        requestId: id,
      })
      .expect(409);
    expect(await db.user.count({ where: { email: 'psme2@nwssu.test' } })).toBe(0);
  });
});
