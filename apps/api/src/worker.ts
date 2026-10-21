// The worker: a separate process from the API. It drains the BullMQ queues the API fills
// (src/lib/queue.ts): checks, scans and processes each uploaded version and appeal
// attachment, renders each clean version's watermarked view-only pages, sweeps abandoned uploads, runs the hourly compliance check, sends
// notification emails, makes Semestral End Reports and recomputes the leaderboard. Run with `pnpm --filter api dev:worker` (part of `pnpm dev`).
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { academicYearSchema, semesterSchema } from '@orghive/shared';
import { z } from 'zod';
import { ConfigError, loadConfig, type Config } from '#src/config';
import { createRedis, createRedisCache } from '#src/lib/cache';
import { createClamavScanner } from '#src/lib/clamav';
import * as tools from '#src/lib/file-processing';
import { createGotenbergConverter } from '#src/lib/office-converter';
import * as previewRenderer from '#src/lib/preview-render';
import { createRedisLeaderboardEvents } from '#src/lib/leaderboard-events';
import { createRedisLeaderboardStore } from '#src/lib/leaderboard-store';
import { createSmtpMailer } from '#src/lib/mailer';
import {
  createBullLeaderboardQueue,
  createBullNotificationQueue,
  createBullPreviewQueue,
  createBullQueue,
  createBullReportQueue,
  createQueueConnection,
  DOCUMENT_QUEUE,
  EMAILS_PER_SECOND,
  LEADERBOARD_QUEUE,
  NOTIFICATION_QUEUE,
  PREVIEW_QUEUE,
  REPORT_QUEUE,
  type DocumentJob,
  type LeaderboardJob,
  type NotificationJob,
  type PreviewJob,
  type ReportJob,
} from '#src/lib/queue';
import { createChromiumRenderer } from '#src/lib/report-pdf';
import { createS3Storage } from '#src/lib/storage';
import { createLogger } from '#src/logger';
import { createAppealRepository } from '#src/repositories/appeal.repository';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createAccountRepository } from '#src/repositories/account.repository';
import { createNotificationRepository } from '#src/repositories/notification.repository';
import { createOrgFreezeRepository } from '#src/repositories/org-freeze.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { createDocumentTypeRepository } from '#src/repositories/document-type.repository';
import { createLeaderboardRepository } from '#src/repositories/leaderboard.repository';
import { createDb } from '#src/repositories/prisma';
import { createProjectRepository } from '#src/repositories/project.repository';
import { createReportRepository } from '#src/repositories/report.repository';
import { createSystemSettingRepository } from '#src/repositories/system-setting.repository';
import { createUploadIntentRepository } from '#src/repositories/upload-intent.repository';
import { createCompliance } from '#src/services/compliance.service';
import { createLeaderboardRecompute, openSemesters } from '#src/services/leaderboard-recompute';
import { createLeaderboardService } from '#src/services/leaderboard.service';
import {
  createNotificationMailer,
  createNotificationService,
} from '#src/services/notification.service';
import {
  createAttachmentProcessing,
  createPendingRequeue,
  createProcessingService,
} from '#src/services/processing.service';
import { createPreviewService, queuePendingPreviews } from '#src/services/preview.service';
import { createProjectSync } from '#src/services/project-sync.service';
import { createTermReminders } from '#src/services/term-reminders.service';
import { createRevealRepository } from '#src/repositories/reveal.repository';
import { createRecipients } from '#src/services/recipients.service';
import { createReportService } from '#src/services/report.service';
import { createSystemSettingsService } from '#src/services/system-settings.service';

/**
 * A report's lock: long enough that merging hundreds of pages (CPU-bound, so lock renewals
 * can be late) never makes BullMQ think the job stalled and start it twice.
 */
const REPORT_LOCK_MS = 10 * 60 * 1000;

/** A version still pending this long lost its job; the sweep queues it again. */
const STALE_PENDING_MS = 10 * 60 * 1000;
/**
 * Previews still pending (lost jobs, and files from before previews existed) queued per sweep,
 * so a large backfill spreads over several sweeps; `pages:backfill` queues them all at once.
 */
const PREVIEWS_PER_SWEEP = 200;
const SWEEP_EVERY_MS = 30 * 60 * 1000;
/**
 * The compliance check (docs/PROJECT_WORKFLOW_SPEC.md, section 3). Reads run the same check
 * for what they show, so this only matters for projects nobody opens.
 */
const COMPLIANCE_EVERY_MS = 60 * 60 * 1000;
/**
 * The leaderboard's daily run: Manila midnight, when event days pass and semesters roll
 * over (docs/PROJECT_WORKFLOW_SPEC.md, section 5B). Seconds first, as BullMQ cron reads it.
 */
const LEADERBOARD_DAILY_CRON = '0 0 0 * * *';
const MANILA_TZ = 'Asia/Manila';

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
const leaderboardQueue = createBullLeaderboardQueue(connection);
const projectRepo = createProjectRepository(db);
const recompute = createLeaderboardRecompute({
  queue: leaderboardQueue,
  projects: projectRepo,
  logger,
});
const notificationRepo = createNotificationRepository(db);
const notifications = createNotificationService({
  notifications: notificationRepo,
  queue: notificationQueue,
  logger,
});
const projectSync = createProjectSync({
  projects: projectRepo,
  leaderboard: recompute,
  compliance: createCompliance({
    freezes: createOrgFreezeRepository(db),
    recipients: createRecipients({
      accounts: createAccountRepository(db),
      organizations: createOrganizationRepository(db),
    }),
    notifications,
    audit,
  }),
});

const previewQueue = createBullPreviewQueue(connection);
const previews = createPreviewService({
  documents,
  storage,
  renderer: previewRenderer,
  converter: createGotenbergConverter({ url: config.GOTENBERG_URL }),
  cache: createRedisCache(redis, logger),
  logger,
});
const processing = createProcessingService({
  documents,
  intents: createUploadIntentRepository(db),
  storage,
  scanner,
  tools,
  previews: previewQueue,
  audit,
  cache: createRedisCache(redis, logger),
  logger,
  onDocumentScanned: (documentId) => projectSync.documentScanned(documentId),
  notifications,
});
const attachments = createAttachmentProcessing({
  appeals: createAppealRepository(db),
  storage,
  scanner,
  tools,
  audit,
  logger,
  notifications,
});
const requeueStale = createPendingRequeue({
  findStalePending: (before) => documents.findStalePending(before),
  queue: jobs,
});
const revealReads = createRevealRepository(db);
const termReminders = createTermReminders({
  accounts: createAccountRepository(db),
  notifications,
});
const mail = createNotificationMailer({
  notifications: notificationRepo,
  mailer: createSmtpMailer(config),
  webOrigin: config.WEB_ORIGIN,
});
const leaderboard = createLeaderboardService({
  leaderboard: createLeaderboardRepository(db),
  settings: createSystemSettingsService({ settings: createSystemSettingRepository(db), audit }),
  store: createRedisLeaderboardStore(redis, logger),
  events: createRedisLeaderboardEvents(redis, logger),
});
const reportQueue = createBullReportQueue(connection);
const reports = createReportService({
  reports: createReportRepository(db),
  documents,
  documentTypes: createDocumentTypeRepository(db),
  storage,
  queue: reportQueue,
  renderer: () => createChromiumRenderer(config.CHROMIUM_EXECUTABLE_PATH),
  previews: previewQueue,
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
      const staleBefore = new Date(Date.now() - STALE_PENDING_MS);
      const requeued = await requeueStale(staleBefore);
      const previewsQueued = await queuePendingPreviews(
        { documents, queue: previewQueue },
        { before: staleBefore, max: PREVIEWS_PER_SWEEP },
      );
      if (removed || requeued || previewsQueued) {
        logger.info({ removed, requeued, previewsQueued }, 'Upload sweep');
      }
      return { removed, requeued, previewsQueued };
    }
    case 'check-compliance': {
      const checked = await projectSync.syncAll();
      const termsEnding = await termReminders.run();
      // Temporary passwords nobody revealed within REVEAL_TTL_DAYS are erased.
      const revealsErased = await revealReads.purgeExpired(new Date());
      logger.info({ checked, termsEnding, revealsErased }, 'Compliance check');
      return { checked, termsEnding, revealsErased };
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

const semesterJobSchema = z.object({ academicYear: academicYearSchema, semester: semesterSchema });

async function handleLeaderboard(
  job: Job<LeaderboardJob['data'], unknown, LeaderboardJob['name']>,
) {
  switch (job.name) {
    case 'recompute': {
      const parsed = semesterJobSchema.safeParse(job.data);
      if (!parsed.success) throw new UnrecoverableError('Job has no semester');
      await leaderboard.compute(parsed.data);
      return parsed.data;
    }
    case 'daily': {
      const semesters = openSemesters(new Date());
      for (const semester of semesters) await leaderboard.compute(semester);
      logger.info({ semesters }, 'Leaderboard daily recompute');
      return semesters;
    }
    default:
      throw new UnrecoverableError(`Unknown job ${String(job.name)}`);
  }
}

async function handlePreview(job: Job<PreviewJob['data'], unknown, PreviewJob['name']>) {
  const { versionId } = job.data as { versionId?: unknown };
  if (typeof versionId !== 'string') throw new UnrecoverableError('Job has no versionId');
  // On the last try a file that still cannot be rendered is marked failed, not left pending.
  const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
  return previews.renderVersion(versionId, { lastAttempt });
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
  // An update to every member queues many emails at once; the relay gets them steadily.
  limiter: { max: EMAILS_PER_SECOND, duration: 1000 },
});
// One report at a time: each runs Chromium and holds every file of a semester in memory.
const reportWorker = new Worker(REPORT_QUEUE, handleReport, {
  connection,
  concurrency: 1,
  lockDuration: REPORT_LOCK_MS,
});
// One preview at a time: each renders up to 500 pages, and scans must never wait behind it.
const previewWorker = new Worker(PREVIEW_QUEUE, handlePreview, { connection, concurrency: 1 });
// One recompute at a time: each reads every project of a semester.
const leaderboardWorker = new Worker(LEADERBOARD_QUEUE, handleLeaderboard, {
  connection,
  concurrency: 1,
});
for (const w of [worker, mailWorker, previewWorker, reportWorker, leaderboardWorker]) {
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
await leaderboardQueue.queue.upsertJobScheduler(
  'leaderboard-daily',
  { pattern: LEADERBOARD_DAILY_CRON, tz: MANILA_TZ },
  { name: 'daily', data: {} },
);
logger.info(
  {
    queues: [DOCUMENT_QUEUE, NOTIFICATION_QUEUE, PREVIEW_QUEUE, REPORT_QUEUE, LEADERBOARD_QUEUE],
  },
  'Worker started',
);

async function shutdown(signal: string) {
  logger.info({ signal }, 'Worker shutting down');
  await Promise.allSettled([
    worker.close(),
    mailWorker.close(),
    previewWorker.close(),
    reportWorker.close(),
    leaderboardWorker.close(),
  ]);
  await Promise.allSettled([
    jobs.queue.close(),
    notificationQueue.queue.close(),
    previewQueue.queue.close(),
    reportQueue.queue.close(),
    leaderboardQueue.queue.close(),
    connection.quit(),
    redis.quit(),
    db.$disconnect(),
  ]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
