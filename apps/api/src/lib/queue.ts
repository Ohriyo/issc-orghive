import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { SemesterKey } from '@orghive/shared';

/** BullMQ queue the API fills and the worker (src/worker.ts) drains. */
export const DOCUMENT_QUEUE = 'document-processing';
/** Notification emails, apart from file processing so a slow SMTP relay never holds up scans. */
export const NOTIFICATION_QUEUE = 'notifications';
/** Semestral End Reports: long, CPU-heavy jobs, one at a time, apart from the scans. */
export const REPORT_QUEUE = 'reports';
/** Leaderboard recomputes (docs/PROJECT_WORKFLOW_SPEC.md, section 5), one at a time. */
export const LEADERBOARD_QUEUE = 'leaderboard';

export type DocumentJob =
  /** Check, scan and process one uploaded version. */
  | { name: 'process-version'; data: { versionId: string } }
  /** Check and scan one appeal attachment (not a document). */
  | { name: 'process-appeal-attachment'; data: { attachmentId: string } }
  /** Delete uploads whose URL expired without being claimed by a document. */
  | { name: 'sweep-uploads'; data: Record<string, never> }
  /**
   * Hourly: re-applies every project's rules (docs/PROJECT_WORKFLOW_SPEC.md, sections 2B
   * and 3): unlocks post-event reports, blocks projects, freezes organizations, and sends
   * deadline reminders; also tells officers and advisers whose term ends soon (term-reminders).
   * Idempotent, so running it twice changes nothing.
   */
  | { name: 'check-compliance'; data: Record<string, never> };

export type NotificationJob = { name: 'send-email'; data: { notificationId: string } };

/** Notification emails are queued this many per addBulk call. */
export const EMAIL_ENQUEUE_CHUNK = 500;
/** The mail worker sends at most this many emails per second, to spare the SMTP relay. */
export const EMAILS_PER_SECOND = 10;

export type ReportJob = { name: 'generate-report'; data: { reportId: string } };

export type LeaderboardJob =
  /** Rank one semester again, write its snapshot and tell the API instances if it changed. */
  | { name: 'recompute'; data: SemesterKey }
  /**
   * Daily at Manila midnight: the current and the previous semester. Covers event days
   * passing, the semester rollover and the daily snapshot.
   */
  | { name: 'daily'; data: Record<string, never> };

/** A semester is recomputed at most once per this window, however many changes arrive. */
export const LEADERBOARD_DEBOUNCE_MS = 5_000;

export interface LeaderboardQueue {
  enqueueRecompute(semester: SemesterKey): Promise<void>;
}

export interface ReportQueue {
  enqueueReport(reportId: string): Promise<void>;
}

/** What the API needs from the queue; tests pass a fake. */
export interface JobQueue {
  enqueueProcessing(versionId: string): Promise<void>;
}

/** Appeal attachments are scanned by the same worker as documents. */
export interface AttachmentQueue {
  enqueueAttachmentScan(attachmentId: string): Promise<void>;
}

export interface NotificationQueue {
  enqueueEmails(notificationIds: string[]): Promise<void>;
}

/** BullMQ requires maxRetriesPerRequest: null on connections that block (workers). */
export function createQueueConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

const RETRIES = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: 1_000,
  removeOnFail: 5_000,
} as const;

export function createBullQueue(connection: Redis): JobQueue & AttachmentQueue & { queue: Queue } {
  const queue = new Queue(DOCUMENT_QUEUE, { connection });
  return {
    queue,
    async enqueueProcessing(versionId) {
      // One job per version, even if a request is retried.
      await queue.add(
        'process-version',
        { versionId },
        { jobId: `version-${versionId}`, ...RETRIES },
      );
    },
    async enqueueAttachmentScan(attachmentId) {
      await queue.add(
        'process-appeal-attachment',
        { attachmentId },
        { jobId: `appeal-attachment-${attachmentId}`, ...RETRIES },
      );
    },
  };
}

export function createBullNotificationQueue(
  connection: Redis,
): NotificationQueue & { queue: Queue } {
  const queue = new Queue(NOTIFICATION_QUEUE, { connection });
  return {
    queue,
    async enqueueEmails(notificationIds) {
      // One job per notification: its jobId makes a repeat add a no-op, and sendEmail skips
      // anything already emailed even after the job itself is removed. An ISSC update can
      // reach every member, so the adds go in chunks rather than one huge Redis call.
      for (let i = 0; i < notificationIds.length; i += EMAIL_ENQUEUE_CHUNK) {
        await queue.addBulk(
          notificationIds.slice(i, i + EMAIL_ENQUEUE_CHUNK).map((notificationId) => ({
            name: 'send-email',
            data: { notificationId },
            opts: { jobId: `email-${notificationId}`, ...RETRIES },
          })),
        );
      }
    },
  };
}

export function createBullReportQueue(connection: Redis): ReportQueue & { queue: Queue } {
  const queue = new Queue(REPORT_QUEUE, { connection });
  return {
    queue,
    async enqueueReport(reportId) {
      // One attempt: the service records a failure for the officer, who can try again.
      await queue.add(
        'generate-report',
        { reportId },
        { jobId: `report-${reportId}`, attempts: 1, removeOnComplete: 200, removeOnFail: 500 },
      );
    },
  };
}

export function createBullLeaderboardQueue(
  connection: Redis,
): LeaderboardQueue & { queue: Queue } {
  const queue = new Queue(LEADERBOARD_QUEUE, { connection });
  return {
    queue,
    async enqueueRecompute({ academicYear, semester }) {
      // One delayed job per semester: changes within the next 5 s join it. keepLastIfActive
      // queues exactly one more run for a change that arrives while it runs, since the run
      // may already have read the data before that change.
      await queue.add(
        'recompute',
        { academicYear, semester },
        {
          delay: LEADERBOARD_DEBOUNCE_MS,
          deduplication: {
            id: `leaderboard-${academicYear}-${semester}`,
            keepLastIfActive: true,
          },
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      );
    },
  };
}
