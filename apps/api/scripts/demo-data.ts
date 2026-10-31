// Demo data for development and demos (docs/DEPLOYMENT.md, "Demo data"). Never part of the
// normal seed, and removed before deployment.
//
//   pnpm --filter api db:seed:demo     # writes it (removes any old demo data first; safe twice)
//   pnpm --filter api db:unseed:demo   # deletes every is_demo row and every file under demo/
//
// Needs the normal seed (db:seed) for the organizations and their accounts. Keep the worker
// running (pnpm dev) so the demo files get their view-only page images.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LEADERBOARD_TYPES,
  PROJECT_TASK_DOCUMENT_TYPES,
  semesterKeyOf,
  type ProjectTaskType,
} from '@orghive/shared';
import { ConfigError, loadConfig, type Config } from '#src/config';
import { createRedis, createRedisCache } from '#src/lib/cache';
import { pdfText } from '#src/lib/file-processing';
import { createRedisLeaderboardEvents } from '#src/lib/leaderboard-events';
import { createRedisLeaderboardStore } from '#src/lib/leaderboard-store';
import { createBullPreviewQueue, createQueueConnection } from '#src/lib/queue';
import { createS3Storage } from '#src/lib/storage';
import { createLogger } from '#src/logger';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createDemoDataRepository } from '#src/repositories/demo-data.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createLeaderboardRepository } from '#src/repositories/leaderboard.repository';
import { createDb } from '#src/repositories/prisma';
import { createSystemSettingRepository } from '#src/repositories/system-setting.repository';
import { createDemoDataService } from '#src/services/demo-data.service';
import { createLeaderboardService } from '#src/services/leaderboard.service';
import { queuePendingPreviews } from '#src/services/preview.service';
import { createSystemSettingsService } from '#src/services/system-settings.service';

const mode = process.argv[2];
if (mode !== 'seed' && mode !== 'unseed') {
  console.error('Usage: tsx scripts/demo-data.ts seed|unseed');
  process.exit(1);
}

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
if (mode === 'seed' && config.NODE_ENV === 'production') {
  console.error('Demo data is never seeded in production.');
  process.exit(1);
}

const ASSETS = join(import.meta.dirname, '..', 'prisma', 'seed', 'demo-assets');
const files = new Map<ProjectTaskType, Buffer>();
function fileFor(type: ProjectTaskType): Buffer {
  let body = files.get(type);
  if (!body) {
    body = readFileSync(join(ASSETS, `${PROJECT_TASK_DOCUMENT_TYPES[type].slug}.pdf`));
    files.set(type, body);
  }
  return body;
}

const logger = createLogger({ ...config, LOG_LEVEL: 'warn' });
const db = createDb(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
const audit = createAuditLogRepository(db);
const settings = createSystemSettingsService({
  settings: createSystemSettingRepository(db),
  audit,
  onLatePointsChanged: () => Promise.resolve(),
});
const standings = createLeaderboardRepository(db);
const store = createRedisLeaderboardStore(redis, logger);
const events = createRedisLeaderboardEvents(redis, logger);
// Outside a request, the removed semesters are ranked again at once.
const leaderboard = createLeaderboardService({ leaderboard: standings, settings, store, events });

const demo = createDemoDataService({
  demo: createDemoDataRepository(db),
  standings,
  settings,
  store,
  events,
  storage: createS3Storage(config),
  cache: createRedisCache(redis, logger),
  audit,
  standingsChanged: async (dates) => {
    const semesters = new Map(
      dates.map((d) => [JSON.stringify(semesterKeyOf(d)), semesterKeyOf(d)]),
    );
    for (const semester of semesters.values()) await leaderboard.compute(semester);
  },
  fileFor,
  textOf: async (pdf) => (await pdfText(pdf)) || null,
  showBadge: config.SHOW_DEMO_BADGE,
});

async function queuePreviews(): Promise<number> {
  const connection = createQueueConnection(config.REDIS_URL);
  const queue = createBullPreviewQueue(connection);
  try {
    return await queuePendingPreviews({ documents: createDocumentRepository(db), queue });
  } finally {
    await queue.queue.close();
    await connection.quit();
  }
}

try {
  if (mode === 'seed') {
    const { counts, boards } = await demo.seed();
    const previews = await queuePreviews();
    console.log(`Demo data seeded: ${counts.total} rows flagged is_demo.`);
    const names = new Map((await standings.publicOrganizations()).map((o) => [o.id, o.acronym]));
    for (const type of LEADERBOARD_TYPES) {
      const rows = boards[type].map((r) => `#${r.rank} ${names.get(r.organizationId) ?? '?'}`);
      console.log(`${type} board: ${rows.join(', ') || '(empty)'}`);
    }
    console.log(`${previews} files queued for their view-only preview; keep the worker running.`);
    console.log('Remove it before deployment: pnpm --filter api db:unseed:demo');
  } else {
    const { removed, files: deleted } = await demo.remove(null, null);
    const total = Object.values(removed).reduce((sum, n) => sum + n, 0);
    console.log(`Demo data removed: ${total} flagged rows, ${deleted} stored files.`);
  }
} finally {
  await db.$disconnect();
  redis.disconnect();
}
