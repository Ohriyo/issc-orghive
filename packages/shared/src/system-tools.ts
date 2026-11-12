import { z } from 'zod';
import { systemAuditEntrySchema, systemAuditQuerySchema } from './system';

/*
 * /system tools for the super admin: background job queues, the security center, cache
 * namespaces, the test email and the audit log export. Every route needs an active
 * SUPER_ADMIN with MFA and is audited; pausing a queue and flushing the cache also need a
 * step-up code.
 */

const countSchema = z.number().int().min(0);

/* ---------- Job queues ---------- */

export const QUEUE_JOB_STATES = ['waiting', 'active', 'delayed', 'failed', 'completed'] as const;
export const queueJobStateSchema = z.enum(QUEUE_JOB_STATES);
export type QueueJobState = z.infer<typeof queueJobStateSchema>;

/** Jobs shown per page of one queue's list. */
export const QUEUE_JOBS_PAGE_SIZE = 25;

export const queueSummarySchema = z
  .object({
    name: z.string(),
    /** Paused: its workers take no new jobs until it is resumed. */
    paused: z.boolean(),
    waiting: countSchema,
    active: countSchema,
    delayed: countSchema,
    failed: countSchema,
    /** Completed jobs BullMQ still keeps (older ones are trimmed). */
    completed: countSchema,
  })
  .meta({ id: 'SystemQueueSummary' });
export type QueueSummary = z.infer<typeof queueSummarySchema>;

/** GET /system/queues */
export const queueListSchema = z
  .object({ queues: z.array(queueSummarySchema), generatedAt: z.iso.datetime() })
  .meta({ id: 'SystemQueueList' });
export type QueueList = z.infer<typeof queueListSchema>;

export const queueParamsSchema = z.object({ queue: z.string().regex(/^[a-z][a-z-]{0,39}$/) });
export const queueJobParamsSchema = queueParamsSchema.extend({
  jobId: z.string().trim().min(1).max(200),
});

/** GET /system/queues/:queue/jobs */
export const queueJobsQuerySchema = z.object({
  state: queueJobStateSchema.default('failed'),
  page: z.coerce.number().int().min(0).max(1000).default(0),
});
export type QueueJobsQuery = z.infer<typeof queueJobsQuerySchema>;

export const queueJobSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    /** The job's input: ids only (a version, a notification, a semester). */
    data: z.record(z.string(), z.unknown()),
    attemptsMade: countSchema,
    maxAttempts: z.number().int().positive().nullable(),
    failedReason: z.string().nullable(),
    queuedAt: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'SystemQueueJob' });
export type QueueJob = z.infer<typeof queueJobSchema>;

export const queueJobListSchema = z
  .object({
    queue: queueSummarySchema,
    state: queueJobStateSchema,
    page: countSchema,
    pageSize: z.number().int().positive(),
    /** Jobs in this state in all, not only on this page. */
    total: countSchema,
    items: z.array(queueJobSchema),
  })
  .meta({ id: 'SystemQueueJobList' });
export type QueueJobList = z.infer<typeof queueJobListSchema>;

/* ---------- Security center ---------- */

export const SECURITY_RANGES = ['24h', '7d'] as const;
export const securityRangeSchema = z.enum(SECURITY_RANGES);
export type SecurityRange = z.infer<typeof securityRangeSchema>;

/** GET /system/security-center */
export const securityCenterQuerySchema = z.object({ range: securityRangeSchema.default('24h') });

/** The most rows each security center list shows. */
export const SECURITY_LIST_MAX = 20;

export const securityCenterSchema = z
  .object({
    range: securityRangeSchema,
    since: z.iso.datetime(),
    /** Wrong passwords, blocked sign-ins (locked or deactivated) and wrong MFA codes. */
    failedLogins: z.object({
      total: countSchema,
      byIp: z.array(
        z.object({ ip: z.string().nullable(), count: countSchema, lastAt: z.iso.datetime() }),
      ),
      byAccount: z.array(
        z.object({
          /** Null when the email belongs to no account. */
          userId: z.uuid().nullable(),
          /** The account's email, or the unknown email that was typed. */
          email: z.string().nullable(),
          organization: z.string().nullable(),
          count: countSchema,
          lastAt: z.iso.datetime(),
        }),
      ),
    }),
    /** Organization accounts on hold (locked with a reason by a super admin or the end of term). */
    lockedAccounts: z.array(
      z.object({
        userId: z.uuid(),
        email: z.string(),
        organization: z.string().nullable(),
        lockedAt: z.iso.datetime(),
        reason: z.string().nullable(),
      }),
    ),
    /** 5 failed super admin attempts in 15 minutes: each locks that account and IP for 15 minutes. */
    superAdminLockouts: z.array(
      z.object({
        at: z.iso.datetime(),
        userId: z.uuid().nullable(),
        email: z.string().nullable(),
        ip: z.string().nullable(),
      }),
    ),
    /** Requests refused with 429 by a rate limit (sign-in, password reset, viewer…). */
    rateLimitHits: z.object({
      total: countSchema,
      byLimiter: z.array(z.object({ limiter: z.string(), hits: countSchema })),
      byIp: z.array(z.object({ ip: z.string(), hits: countSchema, limiters: z.array(z.string()) })),
    }),
    /** What super admins did lately (page views left out). */
    recentAdminActions: z.array(systemAuditEntrySchema),
    /** Files the worker refused: a virus, a wrong file type or a failed task file check. */
    quarantined: z.object({
      total: countSchema,
      items: z.array(
        z.object({
          documentId: z.uuid(),
          organization: z.object({ acronym: z.string(), slug: z.string() }),
          /** Null for a private file: its title stays hidden from the super admin. */
          title: z.string().nullable(),
          kind: z.enum(['virus', 'file_type', 'task_check', 'unknown']),
          reason: z.string().nullable(),
          mimeType: z.string(),
          sizeBytes: countSchema,
          uploadedAt: z.iso.datetime(),
          quarantinedAt: z.iso.datetime().nullable(),
        }),
      ),
    }),
    generatedAt: z.iso.datetime(),
  })
  .meta({ id: 'SystemSecurityCenter' });
export type SecurityCenter = z.infer<typeof securityCenterSchema>;

/* ---------- Cache ---------- */

export const CACHE_NAMESPACES = [
  'organizations',
  'colleges',
  'search',
  'updates',
  'document-types',
  'leaderboard',
  'semesters',
  'demo',
] as const;
export const cacheNamespaceSchema = z.enum(CACHE_NAMESPACES);
export type CacheNamespace = z.infer<typeof cacheNamespaceSchema>;

/** GET /system/cache */
export const cacheStatsSchema = z
  .object({
    namespaces: z.array(
      z.object({
        id: cacheNamespaceSchema,
        label: z.string(),
        description: z.string(),
        keys: countSchema,
      }),
    ),
    /** Every key in Redis, sessions, rate limits and queues included. */
    totalKeys: countSchema.nullable(),
    usedMemoryBytes: countSchema.nullable(),
    generatedAt: z.iso.datetime(),
  })
  .meta({ id: 'SystemCacheStats' });
export type CacheStats = z.infer<typeof cacheStatsSchema>;

/** POST /system/cache/flush (step-up) */
export const flushCacheRequestSchema = z.strictObject({ namespace: cacheNamespaceSchema });
export type FlushCacheRequest = z.infer<typeof flushCacheRequestSchema>;

export const flushCacheResponseSchema = z
  .object({ namespace: cacheNamespaceSchema, deleted: countSchema })
  .meta({ id: 'FlushCacheResponse' });
export type FlushCacheResponse = z.infer<typeof flushCacheResponseSchema>;

/* ---------- Test email ---------- */

/** POST /system/email-test: to the super admin's own address unless another is given. */
export const emailTestRequestSchema = z.strictObject({
  to: z.email().max(254).optional(),
});
export type EmailTestRequest = z.infer<typeof emailTestRequestSchema>;

export const emailTestResponseSchema = z
  .object({
    to: z.email(),
    delivered: z.boolean(),
    /** Why the SMTP relay refused it, when it did. */
    error: z.string().nullable(),
    durationMs: countSchema,
    sentAt: z.iso.datetime(),
  })
  .meta({ id: 'EmailTestResponse' });
export type EmailTestResponse = z.infer<typeof emailTestResponseSchema>;

/* ---------- Audit log export ---------- */

/** GET /system/audit-logs/export: the same filters as the list, as CSV, newest first. */
export const systemAuditExportQuerySchema = systemAuditQuerySchema.omit({
  cursor: true,
  limit: true,
});
export type SystemAuditExportQuery = z.infer<typeof systemAuditExportQuerySchema>;

/** The most rows one export holds; narrow the filters for more. */
export const AUDIT_EXPORT_MAX_ROWS = 10_000;

/** Set on an export that stopped at AUDIT_EXPORT_MAX_ROWS. */
export const AUDIT_EXPORT_TRUNCATED_HEADER = 'X-Orghive-Truncated';
