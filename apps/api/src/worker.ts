// The upload worker: a separate process from the API. It drains the BullMQ queue the API
// fills (src/lib/queue.ts): checks, scans and processes each uploaded version, and sweeps
// abandoned uploads. Run with `pnpm --filter api dev:worker` (part of `pnpm dev`).
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { ConfigError, loadConfig, type Config } from '#src/config';
import { createRedis, createRedisCache } from '#src/lib/cache';
import { createClamavScanner } from '#src/lib/clamav';
import * as tools from '#src/lib/file-processing';
import {
  createBullQueue,
  createQueueConnection,
  DOCUMENT_QUEUE,
  type DocumentJob,
} from '#src/lib/queue';
import { createS3Storage } from '#src/lib/storage';
import { createLogger } from '#src/logger';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createDb } from '#src/repositories/prisma';
import { createUploadIntentRepository } from '#src/repositories/upload-intent.repository';
import { createPendingRequeue, createProcessingService } from '#src/services/processing.service';

/** A version still pending this long lost its job; the sweep queues it again. */
const STALE_PENDING_MS = 10 * 60 * 1000;
const SWEEP_EVERY_MS = 30 * 60 * 1000;

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

const logger = createLogger(config).child({ process: 'worker' });
const db = createDb(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
redis.on('error', (err) => logger.warn({ err }, 'Redis connection error'));
const connection = createQueueConnection(config.REDIS_URL);
const jobs = createBullQueue(connection);
const documents = createDocumentRepository(db);

const processing = createProcessingService({
  documents,
  intents: createUploadIntentRepository(db),
  storage: createS3Storage(config),
  scanner: createClamavScanner({ host: config.CLAMAV_HOST, port: config.CLAMAV_PORT }),
  tools,
  audit: createAuditLogRepository(db),
  cache: createRedisCache(redis, logger),
  logger,
});
const requeueStale = createPendingRequeue({
  findStalePending: (before) => documents.findStalePending(before),
  queue: jobs,
});

async function handle(job: Job<DocumentJob['data'], unknown, DocumentJob['name']>) {
  switch (job.name) {
    case 'process-version': {
      const { versionId } = job.data as { versionId?: unknown };
      if (typeof versionId !== 'string') throw new UnrecoverableError('Job has no versionId');
      return processing.processVersion(versionId);
    }
    case 'sweep-uploads': {
      const removed = await processing.sweepAbandonedUploads();
      const requeued = await requeueStale(new Date(Date.now() - STALE_PENDING_MS));
      if (removed || requeued) logger.info({ removed, requeued }, 'Upload sweep');
      return { removed, requeued };
    }
    default:
      throw new UnrecoverableError(`Unknown job ${String(job.name)}`);
  }
}

const worker = new Worker(DOCUMENT_QUEUE, handle, { connection, concurrency: 2 });
worker.on('failed', (job, err) => {
  logger.error({ err, jobId: job?.id, attempts: job?.attemptsMade }, 'Job failed');
});

await jobs.queue.upsertJobScheduler(
  'sweep-uploads',
  { every: SWEEP_EVERY_MS },
  { name: 'sweep-uploads', data: {} },
);
logger.info({ queue: DOCUMENT_QUEUE }, 'Worker started');

async function shutdown(signal: string) {
  logger.info({ signal }, 'Worker shutting down');
  await worker.close();
  await Promise.allSettled([jobs.queue.close(), connection.quit(), redis.quit(), db.$disconnect()]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
