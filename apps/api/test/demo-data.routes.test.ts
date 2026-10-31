import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  authResponseSchema,
  demoDataPreviewSchema,
  demoStatusSchema,
  ErrorCode,
  mfaChallengeSchema,
  removeDemoDataResponseSchema,
} from '@orghive/shared';
import {
  accountFor,
  buildAuthApp,
  createSuperAdmin,
  TEST_PASSWORD,
  totpCode,
} from './auth-fixtures';
import { testDb } from './db';
import { buildDemoService, buildDemoWorld } from './demo-fixtures';
import { testRedis } from './redis';

/*
 * Demo data's routes (docs/DEPLOYMENT.md, "Demo data"): the console's preview and removal,
 * super admins only, the removal after a step-up; and the public "Sample data" status.
 */

const db = testDb();
const redis = testRedis();
let clock: Date;
let world: Awaited<ReturnType<typeof buildDemoWorld>>;

beforeEach(async () => {
  clock = new Date();
  await redis.flushdb();
  world = await buildDemoWorld(db);
});
afterAll(async () => {
  await redis.quit();
});

function build() {
  const demo = buildDemoService(db);
  return { ...buildAuthApp(db, redis, { now: () => clock, demoData: demo.service }), demo };
}
type App = ReturnType<typeof build>['app'];
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function superAdmin(app: App) {
  const { secret } = await createSuperAdmin(db, 'dev@nwssu.test');
  clock = new Date(clock.getTime() + 30_000);
  const first = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'dev@nwssu.test', password: TEST_PASSWORD })
    .expect(200);
  const { challengeToken } = mfaChallengeSchema.parse(first.body);
  const res = await request(app)
    .post('/api/v1/auth/mfa/verify')
    .send({ challengeToken, code: await totpCode(secret, { at: clock }) })
    .expect(200);
  const token = authResponseSchema.parse(res.body).accessToken;
  return {
    token,
    stepUp: async () => {
      clock = new Date(clock.getTime() + 30_000);
      await request(app)
        .post('/api/v1/system/step-up')
        .set(bearer(token))
        .send({ code: await totpCode(secret, { at: clock }) })
        .expect(200);
    },
  };
}

async function orgToken(app: App, slug: string) {
  const email = `${slug}@test.local`;
  await accountFor(db, world.ids.get(slug)!, email);
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: TEST_PASSWORD })
    .expect(200);
  return authResponseSchema.parse(res.body).accessToken;
}

describe('who may use the /system demo data routes', () => {
  it('401s signed out, 403s every organization account (the ISSC included)', async () => {
    const { app } = build();
    const issc = await orgToken(app, 'issc');
    const asit = await orgToken(app, 'asit');
    const calls = [
      (token?: string) => {
        const req = request(app).get('/api/v1/system/demo-data');
        return token ? req.set(bearer(token)) : req;
      },
      (token?: string) => {
        const req = request(app).post('/api/v1/system/demo-data/delete');
        return (token ? req.set(bearer(token)) : req).send({ expectedTotal: 1 });
      },
    ];
    for (const call of calls) {
      expect((await call()).status).toBe(401);
      expect((await call(issc)).status).toBe(403);
      expect((await call(asit)).status).toBe(403);
    }
  });

  it('needs a fresh step-up code to remove it', async () => {
    const { app } = build();
    const { token } = await superAdmin(app);
    const res = await request(app)
      .post('/api/v1/system/demo-data/delete')
      .set(bearer(token))
      .send({ expectedTotal: 1 })
      .expect(403);
    expect((res.body as { error: { code: string } }).error.code).toBe(ErrorCode.STEP_UP_REQUIRED);
  });
});

describe('/system/demo-data', () => {
  it('previews the counts, then removes everything after a step-up, audited', async () => {
    const { app, demo } = build();
    await demo.service.seed();
    const { token, stepUp } = await superAdmin(app);

    const preview = demoDataPreviewSchema.parse(
      (await request(app).get('/api/v1/system/demo-data').set(bearer(token)).expect(200)).body,
    );
    expect(preview.total).toBeGreaterThan(0);
    expect(preview.counts.appeals).toBe(4);

    await stepUp();
    const del = (expectedTotal: number) =>
      request(app)
        .post('/api/v1/system/demo-data/delete')
        .set(bearer(token))
        .send({ expectedTotal });
    await del(preview.total + 1).expect(409);
    await request(app)
      .post('/api/v1/system/demo-data/delete')
      .set(bearer(token))
      .send({ expectedTotal: 0 })
      .expect(400);
    const removed = removeDemoDataResponseSchema.parse((await del(preview.total).expect(200)).body);
    expect(removed.removed.appeals).toBe(4);
    expect(demo.storage.objects.size).toBe(0);
    const entry = await db.auditLog.findFirstOrThrow({ where: { action: 'demo_data_remove' } });
    expect(entry).toMatchObject({ entityType: 'demo_data' });
    expect(entry.actorId).not.toBeNull();
    expect(entry.ip).not.toBeNull();

    const after = demoDataPreviewSchema.parse(
      (await request(app).get('/api/v1/system/demo-data').set(bearer(token)).expect(200)).body,
    );
    expect(after.total).toBe(0);
  });
});

describe('GET /demo-status', () => {
  it('is public and cacheable, and names the organizations showing demo data', async () => {
    const { app, demo } = build();
    const empty = await request(app).get('/api/v1/demo-status').expect(200);
    expect(empty.headers['cache-control']).toBe('public, max-age=60, stale-while-revalidate=300');
    expect(demoStatusSchema.parse(empty.body).organizations).toEqual([]);

    await demo.service.seed();
    const { organizations } = demoStatusSchema.parse(
      (await request(app).get('/api/v1/demo-status').expect(200)).body,
    );
    expect(organizations).toEqual(expect.arrayContaining(['asit', 'tag', 'iso']));
  });
});
