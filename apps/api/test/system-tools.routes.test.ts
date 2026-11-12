import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  authResponseSchema,
  AUDIT_EXPORT_TRUNCATED_HEADER,
  cacheStatsSchema,
  emailTestResponseSchema,
  ErrorCode,
  mfaChallengeSchema,
  queueJobListSchema,
  queueListSchema,
  securityCenterSchema,
  systemAuditListResponseSchema,
  type QueueJob,
  type QueueJobState,
} from '@orghive/shared';
import {
  accountFor,
  buildAuthApp,
  createSuperAdmin,
  TEST_PASSWORD,
  totpCode,
} from './auth-fixtures';
import { buildWorld, resetDb, testDb } from './db';
import { testRedis } from './redis';

/*
 * /api/v1/system tools end to end, on the test database and Redis: queues (an in-memory
 * fake), the security center, cache, the test email and the audit export. Who gets in,
 * which actions need a step-up, and what each one records.
 */

const db = testDb();
const redis = testRedis();
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
const advance = () => {
  clock = new Date(clock.getTime() + 30_000);
};

const job = (id: string, state: QueueJobState): QueueJob & { state: QueueJobState } => ({
  id,
  name: 'process-version',
  data: { versionId: `v${id}` },
  attemptsMade: state === 'failed' ? 3 : 0,
  maxAttempts: 3,
  failedReason: state === 'failed' ? 'ClamAV unreachable' : null,
  queuedAt: new Date().toISOString(),
  startedAt: null,
  finishedAt: null,
  state,
});

function build() {
  return buildAuthApp(db, redis, {
    now: () => clock,
    queueSeed: { documents: [job('1', 'failed'), job('2', 'waiting')], previews: [] },
  });
}
type App = ReturnType<typeof build>['app'];

async function signIn(app: App, email = 'dev@nwssu.test') {
  const { user, secret } = await createSuperAdmin(db, email);
  advance();
  const first = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: TEST_PASSWORD })
    .expect(200);
  const { challengeToken } = mfaChallengeSchema.parse(first.body);
  const res = await request(app)
    .post('/api/v1/auth/mfa/verify')
    .send({ challengeToken, code: await totpCode(secret, { at: clock }) })
    .expect(200);
  return { user, secret, token: authResponseSchema.parse(res.body).accessToken };
}

async function stepUp(app: App, token: string, secret: string) {
  advance();
  await request(app)
    .post('/api/v1/system/step-up')
    .set(bearer(token))
    .send({ code: await totpCode(secret, { at: clock }) })
    .expect(200);
}

async function orgToken(app: App, email: string, organizationId: string) {
  await accountFor(db, organizationId, email);
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: TEST_PASSWORD })
    .expect(200);
  return authResponseSchema.parse(res.body).accessToken;
}

const auditOf = (action: string) =>
  db.auditLog.findMany({ where: { action: action as never }, orderBy: { id: 'asc' } });

describe('/system tools role matrix', () => {
  it(
    'lets only a super admin in, and asks for a step-up before pausing or flushing',
    { timeout: 30_000 },
    async () => {
      const world = await buildWorld(db);
      const { app } = build();
      const officer = await orgToken(app, 'officer@nwssu.test', world.orgs.jpice.id);
      const isscAdmin = await orgToken(app, 'admin@nwssu.test', world.orgs.issc.id);
      const { token } = await signIn(app);

      const calls = [
        () => request(app).get('/api/v1/system/queues'),
        () => request(app).get('/api/v1/system/queues/documents/jobs?state=failed'),
        () => request(app).post('/api/v1/system/queues/documents/jobs/1/retry'),
        () => request(app).post('/api/v1/system/queues/documents/jobs/1/remove'),
        () => request(app).post('/api/v1/system/queues/documents/pause'),
        () => request(app).post('/api/v1/system/queues/documents/resume'),
        () => request(app).get('/api/v1/system/security-center'),
        () => request(app).get('/api/v1/system/cache'),
        () => request(app).post('/api/v1/system/cache/flush').send({ namespace: 'search' }),
        () => request(app).post('/api/v1/system/email-test').send({}),
        () => request(app).get('/api/v1/system/audit-logs/export'),
      ];
      for (const call of calls) {
        expect((await call()).status).toBe(401);
        for (const other of [officer, isscAdmin]) {
          const res = await call().set(bearer(other));
          expect(res.status).toBe(403);
          expect(res.body.error.code).toBe(ErrorCode.FORBIDDEN);
        }
      }

      for (const path of ['/queues', '/security-center', '/cache', '/audit-logs/export']) {
        const res = await request(app).get(`/api/v1/system${path}`).set(bearer(token)).expect(200);
        expect(res.headers['cache-control']).toBe('private, no-store');
      }
      for (const call of [calls[4]!, calls[5]!, calls[8]!]) {
        const res = await call().set(bearer(token));
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe(ErrorCode.STEP_UP_REQUIRED);
      }
    },
  );
});

describe('/system/queues', () => {
  it('lists jobs, retries a failed one, refuses a waiting one, and pauses after a step-up', async () => {
    const { app, queueAdmin } = build();
    const { token, secret, user } = await signIn(app);

    const list = queueListSchema.parse(
      (await request(app).get('/api/v1/system/queues').set(bearer(token)).expect(200)).body,
    );
    expect(list.queues.map((q) => [q.name, q.failed, q.waiting])).toEqual([
      ['documents', 1, 1],
      ['previews', 0, 0],
    ]);

    const failed = queueJobListSchema.parse(
      (
        await request(app)
          .get('/api/v1/system/queues/documents/jobs?state=failed')
          .set(bearer(token))
          .expect(200)
      ).body,
    );
    expect(failed.items).toEqual([
      expect.objectContaining({ id: '1', failedReason: 'ClamAV unreachable' }),
    ]);

    await request(app)
      .post('/api/v1/system/queues/documents/jobs/1/retry')
      .set(bearer(token))
      .expect(204);
    expect(queueAdmin.jobsOf('documents').find((j) => j.id === '1')?.state).toBe('waiting');
    const waiting = await request(app)
      .post('/api/v1/system/queues/documents/jobs/2/remove')
      .set(bearer(token));
    expect(waiting.status).toBe(409);
    await request(app).get('/api/v1/system/queues/nope/jobs').set(bearer(token)).expect(404);
    await request(app)
      .get('/api/v1/system/queues/documents/jobs?state=stuck')
      .set(bearer(token))
      .expect(400);

    await stepUp(app, token, secret);
    const paused = await request(app)
      .post('/api/v1/system/queues/previews/pause')
      .set(bearer(token))
      .expect(200);
    expect(paused.body).toMatchObject({ name: 'previews', paused: true });

    const [retry] = await auditOf('queue_job_retry');
    expect(retry).toMatchObject({
      actorId: user.id,
      entityType: 'queue',
      entityId: 'documents',
      metadata: { queue: 'documents', jobId: '1', name: 'process-version' },
    });
    expect(await auditOf('queue_pause')).toHaveLength(1);
  });
});

describe('/system/security-center', () => {
  it('reports failed sign-ins by IP and account, holds and rate limit hits', async () => {
    const world = await buildWorld(db);
    const { app } = build();
    const officer = await accountFor(db, world.orgs.jpice.id, 'officer@nwssu.test');
    await db.user.update({
      where: { id: officer.id },
      data: { lockedAt: new Date(), lockReason: 'Officer handover' },
    });
    const { token } = await signIn(app);

    // Wrong passwords for a real account and an unknown one; the 6th from this IP is a 429.
    for (const email of ['officer@nwssu.test', 'officer@nwssu.test', 'ghost@nwssu.test']) {
      await request(app).post('/api/v1/auth/login').send({ email, password: 'wrong-password-1' });
    }
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'ghost@nwssu.test', password: 'wrong-password-1' });
    }

    const res = await request(app)
      .get('/api/v1/system/security-center?range=7d')
      .set(bearer(token))
      .expect(200);
    const page = securityCenterSchema.parse(res.body);
    expect(page.range).toBe('7d');
    expect(page.failedLogins.total).toBe(5);
    expect(page.failedLogins.byIp[0]).toMatchObject({ count: 5 });
    expect(page.failedLogins.byAccount).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: officer.id,
          email: 'officer@nwssu.test',
          organization: 'JPICE',
          count: 2,
        }),
        expect.objectContaining({ userId: null, email: 'ghost@nwssu.test', count: 3 }),
      ]),
    );
    expect(page.lockedAccounts).toEqual([
      expect.objectContaining({
        userId: officer.id,
        reason: 'Officer handover',
        organization: 'JPICE',
      }),
    ]);
    expect(page.rateLimitHits.total).toBe(1);
    expect(page.rateLimitHits.byLimiter[0]?.limiter).toMatch(/^login-/);
    // buildWorld has one refused upload (not private, so its title shows).
    expect(page.quarantined.total).toBe(1);
    expect(page.quarantined.items).toEqual([
      expect.objectContaining({
        title: 'JPICE refused upload',
        organization: { acronym: 'JPICE', slug: 'jpice' },
      }),
    ]);
    await request(app)
      .get('/api/v1/system/security-center?range=1y')
      .set(bearer(token))
      .expect(400);
  });
});

describe('/system/cache', () => {
  it('counts cache keys by namespace and flushes one, leaving sessions and rate limits', async () => {
    const { app } = build();
    const { token, secret, user } = await signIn(app);
    await redis.set('org:jpice:v2', '{}');
    await redis.set('org:jpice:docs:abc', '[]');
    await redis.set('search:gen', '3');
    await redis.set('rl:login-ip:203.0.113.9', '1');

    const stats = cacheStatsSchema.parse(
      (await request(app).get('/api/v1/system/cache').set(bearer(token)).expect(200)).body,
    );
    const keys = Object.fromEntries(stats.namespaces.map((n) => [n.id, n.keys]));
    expect(keys).toMatchObject({ organizations: 2, search: 1, colleges: 0 });
    expect(stats.totalKeys).toBeGreaterThanOrEqual(4);

    await stepUp(app, token, secret);
    // Only the listed namespaces: sessions and rate limits are not cache.
    await request(app)
      .post('/api/v1/system/cache/flush')
      .set(bearer(token))
      .send({ namespace: 'sessions' })
      .expect(400);
    const flushed = await request(app)
      .post('/api/v1/system/cache/flush')
      .set(bearer(token))
      .send({ namespace: 'organizations' })
      .expect(200);
    expect(flushed.body).toEqual({ namespace: 'organizations', deleted: 2 });
    expect(await redis.exists('org:jpice:v2', 'org:jpice:docs:abc')).toBe(0);
    expect(await redis.exists('search:gen', 'rl:login-ip:203.0.113.9')).toBe(2);
    expect((await redis.keys('sa:session:*')).length).toBeGreaterThan(0);
    const [entry] = await auditOf('cache_flush');
    expect(entry).toMatchObject({
      actorId: user.id,
      metadata: { namespace: 'organizations', deleted: 2 },
    });
  });
});

describe('/system/email-test', () => {
  it("sends to the super admin's own address, or another, and audits it", async () => {
    const { app, mailer } = build();
    const { token } = await signIn(app);
    const own = emailTestResponseSchema.parse(
      (await request(app).post('/api/v1/system/email-test').set(bearer(token)).send({}).expect(200))
        .body,
    );
    expect(own).toMatchObject({ to: 'dev@nwssu.test', delivered: true, error: null });
    await request(app)
      .post('/api/v1/system/email-test')
      .set(bearer(token))
      .send({ to: 'it@nwssu.test' })
      .expect(200);
    await request(app)
      .post('/api/v1/system/email-test')
      .set(bearer(token))
      .send({ to: 'not-an-email' })
      .expect(400);
    expect(mailer.sent.filter((m) => m.subject === 'Orghive test email').map((m) => m.to)).toEqual([
      'dev@nwssu.test',
      'it@nwssu.test',
    ]);
    expect(await auditOf('email_test')).toHaveLength(2);
  });
});

describe('/system/audit-logs filters and export', () => {
  it('filters by organization and actor, and exports the same filters as CSV', async () => {
    const world = await buildWorld(db);
    const { app } = build();
    const { token, user } = await signIn(app);
    await db.auditLog.createMany({
      data: [
        {
          action: 'upload',
          entityType: 'document',
          organizationId: world.orgs.jpice.id,
          actingAs: 'Juan',
        },
        {
          action: 'upload',
          entityType: 'document',
          organizationId: world.orgs.psme.id,
          actingAs: 'Maria',
        },
      ],
    });

    const byOrg = systemAuditListResponseSchema.parse(
      (
        await request(app)
          .get(`/api/v1/system/audit-logs?organization=jpice`)
          .set(bearer(token))
          .expect(200)
      ).body,
    );
    expect(byOrg.items.map((e) => e.actingAs)).toEqual(['Juan']);
    const byActor = systemAuditListResponseSchema.parse(
      (
        await request(app)
          .get('/api/v1/system/audit-logs?actor=DEV@')
          .set(bearer(token))
          .expect(200)
      ).body,
    );
    expect(byActor.items.length).toBeGreaterThan(0);
    expect(byActor.items.every((e) => e.actor?.id === user.id)).toBe(true);

    const res = await request(app)
      .get('/api/v1/system/audit-logs/export?action=upload')
      .set(bearer(token))
      .expect(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="orghive-audit-/);
    expect(res.headers[AUDIT_EXPORT_TRUNCATED_HEADER.toLowerCase()]).toBe('0');
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    const lines = res.text.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toMatch(/^Time \(UTC\),Action,/);
    expect(lines.slice(1).map((line) => line.split(',')[4])).toEqual(['Maria', 'Juan']);
    const [entry] = await auditOf('audit_export');
    expect(entry).toMatchObject({
      actorId: user.id,
      metadata: { filters: { action: 'upload' }, rows: 2, truncated: false },
    });
  });
});
