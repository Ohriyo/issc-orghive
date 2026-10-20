/**
 * The leaderboard end to end (docs/LEADERBOARD_PHASES.md, Phase 4.1 and 4.3): each change
 * that moves the standings queues a recompute on the real BullMQ queue, a worker computes it
 * from the database, Redis pub/sub tells the API, and an open SSE stream receives the new
 * boards. Real database, Redis, queue and HTTP; only the clock is fixed.
 */
import { get, type ClientRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Worker } from 'bullmq';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LeaderboardEvent, PublicLeaderboardRow, SemesterKey } from '@orghive/shared';
import { createRedis, memoryCache } from '#src/lib/cache';
import {
  createRedisLeaderboardEvents,
  subscribeLeaderboardChanges,
} from '#src/lib/leaderboard-events';
import { createRedisLeaderboardStore } from '#src/lib/leaderboard-store';
import { createLeaderboardStream } from '#src/lib/leaderboard-stream';
import { createPublicUrl } from '#src/lib/public-url';
import {
  createBullLeaderboardQueue,
  createQueueConnection,
  LEADERBOARD_QUEUE,
  type LeaderboardJob,
} from '#src/lib/queue';
import { createAccountRepository } from '#src/repositories/account.repository';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createFinancialFiguresRepository } from '#src/repositories/financial-figures.repository';
import { createLeaderboardRepository } from '#src/repositories/leaderboard.repository';
import { createNotificationRepository } from '#src/repositories/notification.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { createProjectRepository } from '#src/repositories/project.repository';
import { createSystemSettingRepository } from '#src/repositories/system-setting.repository';
import { createFinancialFiguresService } from '#src/services/financial-figures.service';
import { createLeaderboardRecompute } from '#src/services/leaderboard-recompute';
import { createLeaderboardService } from '#src/services/leaderboard.service';
import { createNotificationService } from '#src/services/notification.service';
import { createProjectSync } from '#src/services/project-sync.service';
import { createPublicLeaderboardService } from '#src/services/public-leaderboard.service';
import { createRecipients } from '#src/services/recipients.service';
import { createSystemSettingsService } from '#src/services/system-settings.service';
import { buildComplianceWorld, seedProject } from './compliance-fixtures';
import { createTestDocument, testDb } from './db';
import { buildTestApp, TEST_ASSET_BASE_URL } from './helpers';
import { testRedis } from './redis';

/** Dec 1, 2026: the 1st semester of 2026-2027, after the project's event on Sep 15. */
const NOW = new Date('2026-12-01T02:00:00Z');
const now = () => NOW;
/** Names that must never reach a public board (spec 5F). */
const ACTING_AS = 'Juana Actingas';
const OFFICER = 'Pedro Officername';
const REMARK = 'Receipts do not add up';

const db = testDb();
const redis = testRedis();
const subscriber = createRedis(process.env.REDIS_URL_TEST!);
const connection = createQueueConnection(process.env.REDIS_URL_TEST!);
const logger = pino({ level: 'silent' });

let server: Server;
let worker: Worker;
let stream: ClientRequest;
let unsubscribe: () => Promise<void>;
/** Every `standings` event received, raw and parsed. */
const received: { raw: string; event: LeaderboardEvent }[] = [];
let recomputes = 0;

let projectId: string;
let figures: ReturnType<typeof createFinancialFiguresService>;
let settings: ReturnType<typeof createSystemSettingsService>;
let sync: ReturnType<typeof createProjectSync>;
let jpice: { id: string; slug: string };
let officerId: string;
let isscId: string;

/** Resolves with the first event after `after` events that satisfies `test`. */
async function nextEvent(after: number, test: (sbo: PublicLeaderboardRow[]) => boolean) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const found = received.slice(after).find(({ event }) => test(event.boards.SBO));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`no matching standings event after ${after}; got ${received.length}`);
}

const jpiceRow = (sbo: PublicLeaderboardRow[]) => sbo.find((r) => r.organization.slug === 'jpice');

beforeAll(async () => {
  await redis.flushdb();
  const { orgs, ids } = await buildComplianceWorld(db);
  jpice = orgs.jpice;
  officerId = ids.officer;
  isscId = ids.admin;
  await db.officerTerm.updateMany({
    where: { userId: ids.officer, endedAt: null },
    data: { officerName: OFFICER, officerEmail: 'pedro.private@test.local' },
  });

  const projects = createProjectRepository(db);
  const audit = createAuditLogRepository(db);
  const queue = createBullLeaderboardQueue(connection);
  const recompute = createLeaderboardRecompute({ queue, projects, logger, now });
  settings = createSystemSettingsService({
    settings: createSystemSettingRepository(db),
    audit,
    onLatePointsChanged: () => recompute.forOpenSemesters(),
  });
  const leaderboardReads = createLeaderboardRepository(db);
  const leaderboard = createLeaderboardService({
    leaderboard: leaderboardReads,
    settings,
    store: createRedisLeaderboardStore(redis, logger),
    events: createRedisLeaderboardEvents(redis, logger),
    now,
  });
  const publicLeaderboard = createPublicLeaderboardService({
    leaderboard,
    organizations: leaderboardReads,
    settings,
    cache: memoryCache(),
    publicUrl: createPublicUrl(TEST_ASSET_BASE_URL),
    now,
  });
  sync = createProjectSync({ projects, leaderboard: recompute, now });
  figures = createFinancialFiguresService({
    figures: createFinancialFiguresRepository(db),
    projects,
    recipients: createRecipients({
      accounts: createAccountRepository(db),
      organizations: createOrganizationRepository(db),
    }),
    notifications: createNotificationService({
      notifications: createNotificationRepository(db),
      queue: { enqueueEmails: () => Promise.resolve() },
      logger,
    }),
    audit,
    leaderboard: recompute,
    now,
  });

  // The worker's job, as src/worker.ts runs it.
  worker = new Worker(
    LEADERBOARD_QUEUE,
    async (job: { data: LeaderboardJob['data'] }) => {
      recomputes += 1;
      await leaderboard.compute(job.data as SemesterKey);
    },
    { connection: createQueueConnection(process.env.REDIS_URL_TEST!), concurrency: 1 },
  );

  // The API side: the stream hub hears the worker's publications over Redis.
  const hub = createLeaderboardStream({
    boards: (semester) => publicLeaderboard.boards(semester),
    logger,
  });
  unsubscribe = await subscribeLeaderboardChanges(subscriber, logger, (semester) => {
    void hub.changed(semester);
  });
  const app = buildTestApp({ leaderboard: publicLeaderboard, leaderboardStream: hub });
  server = app.listen(0);
  const port = (server.address() as AddressInfo).port;

  // A project whose event passed on Sep 15: proposal and ACR in, the Financial Report not yet.
  const project = await seedProject(db, {
    organizationId: jpice.id,
    createdById: officerId,
    createdAt: new Date('2026-09-01T02:00:00Z'),
    targetDate: '2026-09-15',
    filed: ['PROPOSAL', 'ACR'],
  });
  projectId = project.id;
  await sync.sync(projectId);
  await createFinancialFiguresRepository(db).save(projectId, {
    incomeCentavos: 500_000,
    expensesCentavos: 100_000,
  });

  // A visitor opens the live board.
  await new Promise<void>((resolve, reject) => {
    stream = get(
      `http://127.0.0.1:${port}/api/v1/leaderboard/stream?academicYear=2026-2027&semester=first`,
      (res) => {
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          let end;
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = /^event: standings\ndata: (.*)$/m.exec(frame)?.[1];
            if (data) received.push({ raw: data, event: JSON.parse(data) as LeaderboardEvent });
          }
        });
        resolve();
      },
    );
    stream.on('error', reject);
  });
  await nextEvent(0, () => true);
}, 60_000);

afterAll(async () => {
  stream?.destroy();
  await new Promise<void>((resolve) => {
    server?.closeAllConnections();
    server?.close(() => resolve());
  });
  await unsubscribe?.();
  await worker?.close();
  await Promise.allSettled([subscriber.quit(), connection.quit(), redis.quit()]);
  await db.$disconnect();
});

describe('the live leaderboard, end to end', () => {
  it('starts with nobody ranked: the ACR alone does not implement the project', () => {
    expect(received[0]!.event.boards.SBO).toEqual([]);
  });

  it('ranks the organization once its Financial Report passes the scan (late: 0.5 points)', async () => {
    const before = received.length;
    const runs = recomputes;
    const type = await db.documentType.findUniqueOrThrow({ where: { slug: 'project-proposal' } });
    const report = await createTestDocument(db, {
      organizationId: jpice.id,
      typeId: type.id,
      title: 'Financial Report',
      status: 'available',
      createdById: officerId,
    });
    await createProjectRepository(db).linkDocument(projectId, 'FINANCIAL_REPORT', report.id);
    // Every file of the project was filed by this officer.
    await db.documentVersion.updateMany({
      where: { document: { organizationId: jpice.id } },
      data: { actingAs: ACTING_AS },
    });

    await sync.documentScanned(report.id);

    const { event } = await nextEvent(before, (sbo) => !!jpiceRow(sbo));
    expect(recomputes).toBeGreaterThan(runs);
    // The proposal went in after its Sep 15 deadline: the project earns the late value.
    expect(jpiceRow(event.boards.SBO)).toMatchObject({
      rank: 1,
      points: 0.5,
      implementedCount: 1,
      lateCount: 1,
      netProfitCentavos: 400_000,
      underReviewCount: 0,
    });
  }, 30_000);

  it('moves the profit when the organization corrects its figures', async () => {
    const before = received.length;
    await figures.correct({ userId: officerId }, jpice, projectId, {
      incomeCentavos: 900_000,
      expensesCentavos: 100_000,
      actingAs: ACTING_AS,
    });
    const { event } = await nextEvent(
      before,
      (sbo) => jpiceRow(sbo)?.netProfitCentavos === 800_000,
    );
    expect(jpiceRow(event.boards.SBO)).toMatchObject({ points: 0.5, rankChange: 0 });
  }, 30_000);

  it('leaves flagged figures out of the profit total, keeping the points', async () => {
    const before = received.length;
    await figures.flag(isscId, projectId, REMARK, {});
    const { event } = await nextEvent(before, (sbo) => jpiceRow(sbo)?.underReviewCount === 1);
    expect(jpiceRow(event.boards.SBO)).toMatchObject({
      points: 0.5,
      implementedCount: 1,
      netProfitCentavos: 0,
      underReviewCount: 1,
    });
  }, 30_000);

  it('counts the figures again once the ISSC clears the review', async () => {
    const before = received.length;
    await figures.clearFlag(isscId, projectId, {});
    const { event } = await nextEvent(before, (sbo) => jpiceRow(sbo)?.underReviewCount === 0);
    expect(jpiceRow(event.boards.SBO)).toMatchObject({
      points: 0.5,
      netProfitCentavos: 800_000,
    });
  }, 30_000);

  it('rescores late projects when the super admin changes the late value', async () => {
    const before = received.length;
    await settings.update(isscId, { leaderboardLatePoints: 0.25 }, {});
    const { event } = await nextEvent(before, (sbo) => jpiceRow(sbo)?.points === 0.25);
    expect(event.latePoints).toBe(0.25);
    expect(jpiceRow(event.boards.SBO)).toMatchObject({ lateCount: 1, netProfitCentavos: 800_000 });
  }, 30_000);

  it('never sends a personal name, remark, email or file link (spec 5F)', async () => {
    const res = await request(server).get(
      '/api/v1/leaderboard?type=SBO&academicYear=2026-2027&semester=first',
    );
    expect(res.status).toBe(200);
    for (const text of [JSON.stringify(res.body), ...received.map((r) => r.raw)]) {
      for (const secret of [ACTING_AS, OFFICER, REMARK, '@test.local', 'storageKey', 'test/']) {
        expect(text).not.toContain(secret);
      }
    }
  });
});
