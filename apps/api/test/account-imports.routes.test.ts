import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  authResponseSchema,
  bulkAccountsResultSchema,
  endOfTermResultSchema,
  ErrorCode,
  mfaChallengeSchema,
  notificationListResponseSchema,
  revealResponseSchema,
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
 * The /system CSV imports end to end (docs/DOMAIN_RULES.md, "Accounts"): bulk account
 * creation and the end of term, previewed first, saved in one transaction, the passwords
 * handed to the ISSC account's one-time Reveal as one list.
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
  for (const [slug, acronym] of [
    ['iecep', 'IECEP'],
    ['uapsa', 'UAPSA'],
  ] as const) {
    await db.organization.create({
      data: {
        type: 'SBO',
        slug,
        acronym,
        name: `${acronym} full name`,
        parentId: world.orgs.cscCea.id,
        collegeId: world.colleges.cea.id,
      },
    });
  }
});
afterAll(async () => {
  await redis.quit();
});

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

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
  const step = async () => {
    clock = new Date(clock.getTime() + 30_000);
    return totpCode(secret, { at: clock });
  };
  const first = await login(app, 'dev@nwssu.test').expect(200);
  const { challengeToken } = mfaChallengeSchema.parse(first.body);
  const res = await request(app)
    .post('/api/v1/auth/mfa/verify')
    .send({ challengeToken, code: await step() })
    .expect(200);
  const token = authResponseSchema.parse(res.body).accessToken;
  return {
    token,
    stepUp: async () =>
      request(app)
        .post('/api/v1/system/step-up')
        .set(bearer(token))
        .send({ code: await step() })
        .expect(200),
  };
}

const BULK_CSV = [
  'Organization,College,Officer name,Position,Contact email,Account email',
  'IECEP,CEA,Rosa Lim,President,rosa@nwssu.test,iecep@nwssu.test',
  'UAPSA,CEA,"Reyes, Ana",Governor,ana@nwssu.test,uapsa@nwssu.test',
  'JPICE,CEA,Juan Cruz,President,juan@nwssu.test,jpice-new@nwssu.test',
  'Nope,CEA,Someone,President,someone@nwssu.test,nope@nwssu.test',
].join('\n');

describe('who may import', () => {
  it('401s signed out and 403s organization accounts; the end of term needs a step-up', async () => {
    const { app } = build();
    const issc = await orgToken(app, world.orgs.issc.id, 'issc@test.local');
    for (const path of [
      '/api/v1/system/accounts/bulk/preview',
      '/api/v1/system/accounts/bulk',
      '/api/v1/system/end-of-term/preview',
      '/api/v1/system/end-of-term',
    ]) {
      await request(app).post(path).send({ csv: BULK_CSV }).expect(401);
      await request(app).post(path).set(bearer(issc)).send({ csv: BULK_CSV }).expect(403);
    }
    const { token } = await superAdmin(app);
    const res = await request(app)
      .post('/api/v1/system/end-of-term')
      .set(bearer(token))
      .send({
        csv: 'Organization,Officer name,Position,Contact email\nISSC,A B,President,a@b.test',
      })
      .expect(403);
    expect((res.body as { error: { code: string } }).error.code).toBe(ErrorCode.STEP_UP_REQUIRED);
  });
});

describe('bulk account creation', () => {
  it('previews without saving, then creates the valid rows and hands the passwords over once', async () => {
    const { app } = build();
    const { token } = await superAdmin(app);
    const preview = bulkAccountsResultSchema.parse(
      (
        await request(app)
          .post('/api/v1/system/accounts/bulk/preview')
          .set(bearer(token))
          .send({ csv: BULK_CSV })
          .expect(200)
      ).body,
    );
    expect(preview.counts).toEqual({ create: 2, skip: 1, error: 1 });
    expect(preview.rows.map((r) => [r.line, r.action])).toEqual([
      [2, 'create'],
      [3, 'create'],
      [4, 'skip'],
      [5, 'error'],
    ]);
    expect(await db.user.count({ where: { email: 'iecep@nwssu.test' } })).toBe(0);

    const created = bulkAccountsResultSchema.parse(
      (
        await request(app)
          .post('/api/v1/system/accounts/bulk')
          .set(bearer(token))
          .send({ csv: BULK_CSV })
          .expect(201)
      ).body,
    );
    expect(created.runId).not.toBeNull();
    expect(created.revealExpiresAt).not.toBeNull();
    expect(JSON.stringify(created)).not.toMatch(/temporaryPassword/);
    const uapsa = await db.user.findUniqueOrThrow({
      where: { email: 'uapsa@nwssu.test' },
      include: { officerTerms: true },
    });
    expect(uapsa).toMatchObject({ name: 'UAPSA', mustChangePassword: true });
    expect(uapsa.officerTerms[0]).toMatchObject({
      officerName: 'Reyes, Ana',
      officerPosition: 'Governor',
    });

    // One handover list for the ISSC account, revealed once.
    expect(await db.passwordReveal.count()).toBe(1);
    const issc = await orgToken(app, world.orgs.issc.id, 'issc@test.local');
    const note = notificationListResponseSchema
      .parse((await request(app).get('/api/v1/me/notifications').set(bearer(issc))).body)
      .items.find((n) => n.kind === 'password_reveal')!;
    expect(note.title).toBe('Handover list: 2 new accounts');
    const { entries } = revealResponseSchema.parse(
      (
        await request(app)
          .post(`/api/v1/me/reveals/${note.revealId}/reveal`)
          .set(bearer(issc))
          .expect(200)
      ).body,
    );
    expect(entries.map((e) => e.email).sort()).toEqual(['iecep@nwssu.test', 'uapsa@nwssu.test']);
    const signIn = authResponseSchema.parse(
      (
        await login(
          app,
          'iecep@nwssu.test',
          entries.find((e) => e.email === 'iecep@nwssu.test')!.temporaryPassword,
        ).expect(200)
      ).body,
    );
    expect(signIn.user.mustChangePassword).toBe(true);

    const audits = await db.auditLog.findMany({ where: { action: 'account_create' } });
    expect(audits).toHaveLength(2);
    expect(
      audits.every((a) => (a.metadata as { bulkRunId?: string }).bulkRunId === created.runId),
    ).toBe(true);

    // The same file again: nothing left to create.
    await request(app)
      .post('/api/v1/system/accounts/bulk')
      .set(bearer(token))
      .send({ csv: BULK_CSV })
      .expect(409);
  });

  it('refuses an unreadable file and a missing column', async () => {
    const { app } = build();
    const { token } = await superAdmin(app);
    const send = (csv: string) =>
      request(app).post('/api/v1/system/accounts/bulk/preview').set(bearer(token)).send({ csv });
    const missing = await send('Organization,College\nIECEP,CEA').expect(400);
    expect((missing.body as { error: { message: string } }).error.message).toMatch(
      /Missing columns/,
    );
    await send('').expect(400);
  });

  it('accepts a file over the usual 100 KB request limit', async () => {
    const { app } = build();
    const { token } = await superAdmin(app);
    const padding = 'x'.repeat(240);
    const rows = Array.from(
      { length: 450 },
      (_, i) => `Nope${i},CEA,Officer ${padding},President,o${i}@nwssu.test,n${i}@nwssu.test`,
    );
    const csv = [
      'Organization,College,Officer name,Position,Contact email,Account email',
      ...rows,
    ].join('\n');
    expect(csv.length).toBeGreaterThan(110 * 1024);
    const preview = bulkAccountsResultSchema.parse(
      (
        await request(app)
          .post('/api/v1/system/accounts/bulk/preview')
          .set(bearer(token))
          .send({ csv })
          .expect(200)
      ).body,
    );
    expect(preview.counts.error).toBe(450);
  });
});

describe('the end of term', () => {
  const END_CSV = [
    'Organization,Officer name,Position,Contact email',
    'ISSC,Maria Santos,President,maria@nwssu.test',
    'JPICE,Ana Cruz,President,ana@nwssu.test',
  ].join('\n');

  it('previews, then ends every term, reassigns the listed accounts and locks the rest', async () => {
    const { app } = build();
    const { token, stepUp } = await superAdmin(app);
    const jpiceBefore = await orgToken(app, world.orgs.jpice.id, 'jpice@test.local');
    await orgToken(app, world.orgs.issc.id, 'issc@test.local');
    await db.user.update({
      where: { id: world.users.officer.id },
      data: { lockedAt: new Date(), lockReason: 'x' },
    });

    const preview = endOfTermResultSchema.parse(
      (
        await request(app)
          .post('/api/v1/system/end-of-term/preview')
          .set(bearer(token))
          .send({ csv: END_CSV })
          .expect(200)
      ).body,
    );
    expect(preview.counts).toEqual({ assign: 2, lock: 3, error: 0 });
    expect(preview.toLock.map((l) => l.organization).sort()).toEqual([
      'CSC-CAT',
      'CSC-CEA',
      'PSME',
    ]);
    expect(preview.problems).toEqual([]);

    await stepUp();
    const run = endOfTermResultSchema.parse(
      (
        await request(app)
          .post('/api/v1/system/end-of-term')
          .set(bearer(token))
          .send({ csv: END_CSV, termEnd: '2027-07-31' })
          .expect(200)
      ).body,
    );
    expect(run.isscTemporaryPassword).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);

    // Every session ended; the listed accounts sign in with new passwords.
    await request(app).get('/api/v1/me/notifications').set(bearer(jpiceBefore)).expect(401);
    await login(app, 'jpice@test.local').expect(401);
    const issc = authResponseSchema.parse(
      (await login(app, 'issc@test.local', run.isscTemporaryPassword!).expect(200)).body,
    );
    expect(issc.user.mustChangePassword).toBe(true);

    const jpice = await db.user.findUniqueOrThrow({
      where: { id: world.users.officer.id },
      include: { officerTerms: { orderBy: { createdAt: 'asc' } } },
    });
    expect(jpice).toMatchObject({ lockedAt: null, mustChangePassword: true });
    expect(jpice.officerTerms.at(-1)).toMatchObject({ officerName: 'Ana Cruz', endedAt: null });
    expect(jpice.officerTerms.at(-1)!.termEnd?.toISOString().slice(0, 10)).toBe('2027-07-31');
    expect(jpice.officerTerms.filter((t) => t.endedAt === null)).toHaveLength(1);
    const psme = await db.user.findUniqueOrThrow({ where: { id: world.users.psme.id } });
    expect(psme.lockReason).toBe('End of term: no incoming officer in charge assigned yet');

    // The others' passwords go to the ISSC's Reveal; its own was shown once above.
    const reveal = await db.passwordReveal.findFirstOrThrow({ where: { purpose: 'end_of_term' } });
    expect(reveal).toMatchObject({ recipientId: world.users.issc.id, entryCount: 1 });
    const audits = await db.auditLog.findMany({ where: { action: 'end_of_term' } });
    expect(audits).toHaveLength(6);
    expect(new Set(audits.map((a) => (a.metadata as { runId: string }).runId))).toEqual(
      new Set([run.runId]),
    );
  });

  it('runs only as previewed: errors or a missing ISSC change nothing', async () => {
    const { app } = build();
    const { token, stepUp } = await superAdmin(app);
    await stepUp();
    const run = (csv: string) =>
      request(app).post('/api/v1/system/end-of-term').set(bearer(token)).send({ csv });
    await run(
      'Organization,Officer name,Position,Contact email\nJPICE,Ana Cruz,President,ana@nwssu.test',
    ).expect(409);
    await run(
      'Organization,Officer name,Position,Contact email\nISSC,M S,President,m@nwssu.test\nIECEP,Ana,President,a@nwssu.test',
    ).expect(409);
    expect(await db.user.count({ where: { lockedAt: { not: null } } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: 'end_of_term' } })).toBe(0);
  });
});
