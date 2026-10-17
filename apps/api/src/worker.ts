// The worker: a separate process from the API. It drains the BullMQ queues the API fills
// (src/lib/queue.ts): checks, scans and processes each uploaded version and appeal
// attachment, sweeps abandoned uploads, runs the hourly compliance check, sends
// notification emails, and makes Semestral End Reports. Run with `pnpm --filter api dev:worker` (part of `pnpm dev`).
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { ConfigError, loadConfig, type Config } from '#src/config';
import { createRedis, createRedisCache } from '#src/lib/cache';
import { createClamavScanner } from '#src/lib/clamav';
import * as tools from '#src/lib/file-processing';
import { createSmtpMailer } from '#src/lib/mailer';
import {
  createBullNotificationQueue,
  createBullQueue,
  createBullReportQueue,
  createQueueConnection,
  DOCUMENT_QUEUE,
  NOTIFICATION_QUEUE,
  REPORT_QUEUE,
  type DocumentJob,
  type NotificationJob,
  type ReportJob,
} from '#src/lib/queue';
import { createChromiumRenderer } from '#src/lib/report-pdf';
import { createS3Storage } from '#src/lib/storage';
import { createLogger } from '#src/logger';
import { createAppealRepository } from '#src/repositories/appeal.repository';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createMembershipRepository } from '#src/repositories/membership.repository';
import { createNotificationRepository } from '#src/repositories/notification.repository';
import { createOrgFreezeRepository } from '#src/repositories/org-freeze.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { createDocumentTypeRepository } from '#src/repositories/document-type.repository';
import { createDb } from '#src/repositories/prisma';
import { createProjectRepository } from '#src/repositories/project.repository';
import { createReportRepository } from '#src/repositories/report.repository';
import { createUploadIntentRepository } from '#src/repositories/upload-intent.repository';
import { createCompliance } from '#src/services/compliance.service';
import {
  createNotificationMailer,
  createNotificationService,
} from '#src/services/notification.service';
import {
  createAttachmentProcessing,
  createPendingRequeue,
  createProcessingService,
} from '#src/services/processing.service';
import { createProjectSync } from '#src/services/project-sync.service';
import { createRecipients } from '#src/services/recipients.service';
import { createReportService } from '#src/services/report.service';

/**
 * A report's lock: long enough that merging hundreds of pages (CPU-bound, so lock renewals
 * can be late) never makes BullMQ think the job stalled and start it twice.
 */
const REPORT_LOCK_MS = 10 * 60 * 1000;

/** A version still pending this long lost its job; the sweep queues it again. */
const STALE_PENDING_MS = 10 * 60 * 1000;
const SWEEP_EVERY_MS = 30 * 60 * 1000;
/**
 * The compliance check (docs/PROJECT_WORKFLOW_SPEC.md, section 3). Reads run the same check
 * for what they show, so this only matters for projects nobody opens.
 */
const COMPLIANCE_EVERY_MS = 60 * 60 * 1000;

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
const notificationQueue = createBullNotificationQueue(connection);
const documents = createDocumentRepository(db);
const audit = createAuditLogRepository(db);
const storage = createS3Storage(config);
const scanner = createClamavScanner({ host: config.CLAMAV_HOST, port: config.CLAMAV_PORT });
const notificationRepo = createNotificationRepository(db);
const notifications = createNotificationService({
  notifications: notificationRepo,
  queue: notificationQueue,
  logger,
});
const projectSync = createProjectSync({
  projects: createProjectRepository(db),
  compliance: createCompliance({
    freezes: createOrgFreezeRepository(db),
    recipients: createRecipients({
      memberships: createMembershipRepository(db),
      organizations: createOrganizationRepository(db),
    }),
    notifications,
    audit,
  }),
});

const processing = createProcessingService({
  documents,
  intents: createUploadIntentRepository(db),
  storage,
  scanner,
  tools,
  audit,
  cache: createRedisCache(redis, logger),
  logger,
  onDocumentScanned: (documentId) => projectSync.documentScanned(documentId),
});
const attachments = createAttachmentProcessing({
  appeals: createAppealRepository(db),
  storage,
  scanner,
  tools,
  audit,
  logger,
});
const requeueStale = createPendingRequeue({
  findStalePending: (before) => documents.findStalePending(before),
  queue: jobs,
});
const mail = createNotificationMailer({
  notifications: notificationRepo,
  mailer: createSmtpMailer(config),
  webOrigin: config.WEB_ORIGIN,
});
const reportQueue = createBullReportQueue(connection);
const reports = createReportService({
  reports: createReportRepository(db),
  documents,
  documentTypes: createDocumentTypeRepository(db),
  storage,
  queue: reportQueue,
  renderer: () => createChromiumRenderer(config.CHROMIUM_EXECUTABLE_PATH),
  thumbnail: tools.pdfThumbnail,
  sha256: tools.sha256Hex,
  notifications,
  audit,
  cache: createRedisCache(redis, logger),
  logger,
});

async function handle(job: Job<DocumentJob['data'], unknown, DocumentJob['name']>) {
  switch (job.name) {
    case 'process-version': {
      const { versionId } = job.data as { versionId?: unknown };
      if (typeof versionId !== 'string') throw new UnrecoverableError('Job has no versionId');
      return processing.processVersion(versionId);
    }
    case 'process-appeal-attachment': {
      const { attachmentId } = job.data as { attachmentId?: unknown };
      if (typeof attachmentId !== 'string') {
        throw new UnrecoverableError('Job has no attachmentId');
      }
      return attachments.processAttachment(attachmentId);
    }
    case 'sweep-uploads': {
      const removed = await processing.sweepAbandonedUploads();
      const requeued = await requeueStale(new Date(Date.now() - STALE_PENDING_MS));
      if (removed || requeued) logger.info({ removed, requeued }, 'Upload sweep');
      return { removed, requeued };
    }
    case 'check-compliance': {
      const checked = await projectSync.syncAll();
      logger.info({ checked }, 'Compliance check');
      return { checked };
    }
    default:
      throw new UnrecoverableError(`Unknown job ${String(job.name)}`);
  }
}

async function handleNotification(
  job: Job<NotificationJob['data'], unknown, NotificationJob['name']>,
) {
  const { notificationId } = job.data as { notificationId?: unknown };
  if (typeof notificationId !== 'string') throw new UnrecoverableError('Job has no notificationId');
  return mail.sendEmail(notificationId);
}

async function handleReport(job: Job<ReportJob['data'], unknown, ReportJob['name']>) {
  const { reportId } = job.data as { reportId?: unknown };
  if (typeof reportId !== 'string') throw new UnrecoverableError('Job has no reportId');
  return reports.generate(reportId);
}

const worker = new Worker(DOCUMENT_QUEUE, handle, { connection, concurrency: 2 });
const mailWorker = new Worker(NOTIFICATION_QUEUE, handleNotification, {
  connection,
  concurrency: 2,
});
// One report at a time: each runs Chromium and holds every file of a semester in memory.
const reportWorker = new Worker(REPORT_QUEUE, handleReport, {
  connection,
  concurrency: 1,
  lockDuration: REPORT_LOCK_MS,
});
for (const w of [worker, mailWorker, reportWorker]) {
  w.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id, attempts: job?.attemptsMade }, 'Job failed');
  });
}

await jobs.queue.upsertJobScheduler(
  'sweep-uploads',
  { every: SWEEP_EVERY_MS },
  { name: 'sweep-uploads', data: {} },
);
// Replaced by check-compliance (it runs the same rules, plus blocks, freezes and reminders).
await jobs.queue.removeJobScheduler('sync-projects');
await jobs.queue.upsertJobScheduler(
  'check-compliance',
  { every: COMPLIANCE_EVERY_MS },
  { name: 'check-compliance', data: {} },
);
logger.info({ queues: [DOCUMENT_QUEUE, NOTIFICATION_QUEUE, REPORT_QUEUE] }, 'Worker started');

async function shutdown(signal: string) {
  logger.info({ signal }, 'Worker shutting down');
  await Promise.allSettled([worker.close(), mailWorker.close(), reportWorker.close()]);
  await Promise.allSettled([
    jobs.queue.close(),
    notificationQueue.queue.close(),
    reportQueue.queue.close(),
    connection.quit(),
    redis.quit(),
    db.$disconnect(),
  ]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
