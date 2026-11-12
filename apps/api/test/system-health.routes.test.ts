import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  authResponseSchema,
  BACKGROUND_REQUEST_HEADER,
  ErrorCode,
  mfaChallengeSchema,
  systemAlertsSchema,
  systemHealthSchema,
  systemMetricsSchema,
} from '@orghive/shared';
import { createSystemMetricsRepository } from '#src/repositories/system-metrics.repository';
import { createSuperAdmin, buildAuthApp, TEST_PASSWORD, totpCode } from './auth-fixtures';
import { resetDb, testDb } from './db';
import { testRedis } from './redis';

/*
 * /api/v1/system/health, /metrics and /alerts on the test database: what a super admin
 * reads, what is refused, and that polling is not audited. The role matrix (401/403 for
 * everyone else) is in system.routes.test.ts.
 */

const db = testDb();
const redis = testRedis();
const metricsRepo = createSystemMetricsRepository(db);
let clock: Date;

beforeEach(async () => {
  clock = new Date();
  await redis.flushdb();
  await resetDb(db);
});

afterAll(async () => {
  await redis.quit();
});

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signIn() {
  const { app } = buildAuthApp(db, redis, { now: () => clock });
  const { user, secret } = await createSuperAdmin(db, 'dev@nwssu.test');
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
  return { app, user, token: authResponseSchema.parse(res.body).accessToken };
}

const minutesAgo = (n: number) =>
  new Date(Math.floor(clock.getTime() / 60_000) * 60_000 - n * 60_000);

describe('GET /system/health', () => {
  it('checks every service and lists storage per organization', async () => {
    const { app, token } = await signIn();
    const res = await request(app).get('/api/v1/system/health').set(bearer(token)).expect(200);

    const health = systemHealthSchema.parse(res.body);
    expect(health.checks.map((c) => c.id)).toEqual([
      'api',
      'postgres',
      'redis',
      'storage',
      'worker',
      'clamav',
      'email',
      'disk',
    ]);
    expect(health.status).toBe('ok');
    expect(health.checks.find((c) => c.id === 'postgres')?.facts.map((f) => f.label)).toContain(
      'Database size',
    );
    expect(res.headers['cache-control']).toBe('private, no-store');
  });
});

describe('GET /system/metrics', () => {
  it('charts the saved minutes, with the slowest routes and queries', async () => {
    const { app, token } = await signIn();
    await metricsRepo.save({
      minute: minutesAgo(3),
      source: 'api:test:1',
      requests: 120,
      clientErrors: 6,
      serverErrors: 3,
      p95Ms: 180,
      routes: [
        { route: 'GET /api/v1/documents/:documentId', count: 100, totalMs: 4000, maxMs: 900, p95Ms: 150 },
        { route: 'POST /api/v1/uploads', count: 20, totalMs: 9000, maxMs: 2400, p95Ms: 1200 },
      ],
      slowQueries: [{ route: 'POST /api/v1/uploads', durationMs: 812, query: 'SELECT "public"."documents"' }],
    });
    await metricsRepo.save({ minute: minutesAgo(3), source: 'worker', queueWaiting: 4, storageBytes: 5_000 });

    const res = await request(app)
      .get('/api/v1/system/metrics?range=1h')
      .set(bearer(token))
      .expect(200);
    const metrics = systemMetricsSchema.parse(res.body);

    expect(metrics.bucketMinutes).toBe(1);
    expect(metrics.points.length).toBeGreaterThanOrEqual(60);
    const point = metrics.points.find((p) => p.at === minutesAgo(3).toISOString());
    expect(point).toMatchObject({
      requestsPerMinute: 120,
      p95Ms: 180,
      errorRate: 3 / 120,
      clientErrorRate: 6 / 120,
      queueWaiting: 4,
      storageBytes: 5_000,
    });
    expect(metrics.totals).toEqual({ requests: 120, errorRate: 3 / 120, p95Ms: 180 });
    expect(metrics.slowestEndpoints[0]).toMatchObject({
      route: 'POST /api/v1/uploads',
      requests: 20,
      avgMs: 450,
      p95Ms: 1200,
      maxMs: 2400,
    });
    expect(metrics.slowQueries).toEqual([
      expect.objectContaining({ route: 'POST /api/v1/uploads', durationMs: 812 }),
    ]);
    expect(metrics.activeUsers).toHaveLength(7);
    // The super admin's own sign-in counts today.
    expect(metrics.activeUsers.at(-1)?.users).toBe(1);
  });

  it('draws a day in 5-minute buckets and refuses an unknown range', async () => {
    const { app, token } = await signIn();
    const day = await request(app)
      .get('/api/v1/system/metrics?range=24h')
      .set(bearer(token))
      .expect(200);
    expect(systemMetricsSchema.parse(day.body).bucketMinutes).toBe(5);

    const bad = await request(app)
      .get('/api/v1/system/metrics?range=1y')
      .set(bearer(token))
      .expect(400);
    expect(bad.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
  });
});

describe('GET /system/alerts', () => {
  it('lists open alerts only, oldest first', async () => {
    const { app, token } = await signIn();
    await db.systemAlert.createMany({
      data: [
        { kind: 'disk_full', message: 'The disk is 91% full.', openedAt: minutesAgo(10) },
        { kind: 'worker_down', message: 'The worker is not running.', openedAt: minutesAgo(5) },
        {
          kind: 'error_rate',
          message: 'Resolved earlier.',
          openedAt: minutesAgo(30),
          resolvedAt: minutesAgo(20),
        },
      ],
    });

    const res = await request(app).get('/api/v1/system/alerts').set(bearer(token)).expect(200);
    const { alerts } = systemAlertsSchema.parse(res.body);
    expect(alerts.map((a) => a.kind)).toEqual(['disk_full', 'worker_down']);
  });

  it('audits the first read but not background polls', async () => {
    const { app, token, user } = await signIn();
    await request(app).get('/api/v1/system/alerts').set(bearer(token)).expect(200);
    await request(app)
      .get('/api/v1/system/alerts')
      .set(bearer(token))
      .set(BACKGROUND_REQUEST_HEADER, '1')
      .expect(200);
    await request(app)
      .get('/api/v1/system/health')
      .set(bearer(token))
      .set(BACKGROUND_REQUEST_HEADER, '1')
      .expect(200);

    const views = await db.auditLog.findMany({
      where: { actorId: user.id, action: 'system_view' },
      select: { metadata: true },
    });
    expect(views.map((v) => (v.metadata as { route: string }).route)).toEqual([
      '/api/v1/system/alerts',
    ]);
  });
});
