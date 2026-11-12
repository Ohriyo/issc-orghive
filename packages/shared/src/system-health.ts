import { z } from 'zod';

/*
 * /system/health, /system/metrics and the console's alerts (the super admin only). Health
 * is checked live on each read; metrics come from 1-minute snapshots kept for 7 days.
 */

/** Green, amber, red. */
export const HEALTH_STATUSES = ['ok', 'warn', 'down'] as const;
export const healthStatusSchema = z.enum(HEALTH_STATUSES);
export type HealthStatus = z.infer<typeof healthStatusSchema>;

/** What /system/health checks, in the order it shows them. */
export const HEALTH_CHECK_IDS = [
  'api',
  'postgres',
  'redis',
  'storage',
  'worker',
  'clamav',
  'email',
  'disk',
] as const;
export const healthCheckIdSchema = z.enum(HEALTH_CHECK_IDS);
export type HealthCheckId = z.infer<typeof healthCheckIdSchema>;

/** How a fact's value reads: the console formats it (sizes, durations, dates). */
export const HEALTH_FACT_UNITS = [
  'ms',
  'seconds',
  'bytes',
  'percent',
  'count',
  'datetime',
  'text',
] as const;

export const healthFactSchema = z.object({
  label: z.string(),
  /** A number in `unit`, an ISO date-time for `datetime`, or text; null when unknown. */
  value: z.union([z.number(), z.string()]).nullable(),
  unit: z.enum(HEALTH_FACT_UNITS),
});
export type HealthFact = z.infer<typeof healthFactSchema>;

export const healthCheckSchema = z.object({
  id: healthCheckIdSchema,
  status: healthStatusSchema,
  /** One sentence: what is wrong, or that all is well. */
  summary: z.string(),
  checkedAt: z.iso.datetime(),
  facts: z.array(healthFactSchema),
});
export type HealthCheck = z.infer<typeof healthCheckSchema>;

/** Stored file sizes of one organization (originals of every version, not page images). */
export const organizationStorageSchema = z.object({
  slug: z.string(),
  acronym: z.string(),
  name: z.string(),
  bytes: z.number().int().min(0),
  files: z.number().int().min(0),
});
export type OrganizationStorage = z.infer<typeof organizationStorageSchema>;

/** GET /system/health */
export const systemHealthSchema = z
  .object({
    /** The worst of the checks. */
    status: healthStatusSchema,
    checks: z.array(healthCheckSchema),
    /** Largest first. */
    storageByOrganization: z.array(organizationStorageSchema),
    generatedAt: z.iso.datetime(),
  })
  .meta({ id: 'SystemHealth' });
export type SystemHealth = z.infer<typeof systemHealthSchema>;

/** The chart ranges of /system/metrics, and the bucket each one draws. */
export const METRICS_RANGES = ['1h', '24h', '7d'] as const;
export const metricsRangeSchema = z.enum(METRICS_RANGES);
export type MetricsRange = z.infer<typeof metricsRangeSchema>;

export const METRICS_RANGE_MINUTES: Record<MetricsRange, number> = {
  '1h': 60,
  '24h': 24 * 60,
  '7d': 7 * 24 * 60,
};
/** 60 points for an hour, 288 for a day, 168 for a week. */
export const METRICS_BUCKET_MINUTES: Record<MetricsRange, number> = {
  '1h': 1,
  '24h': 5,
  '7d': 60,
};

/** GET /system/metrics?range= */
export const systemMetricsQuerySchema = z.object({
  range: metricsRangeSchema.default('1h'),
});
export type SystemMetricsQuery = z.infer<typeof systemMetricsQuerySchema>;

export const metricsPointSchema = z.object({
  /** The bucket's start. */
  at: z.iso.datetime(),
  /** Requests per minute, averaged over the bucket. */
  requestsPerMinute: z.number().min(0),
  /** Null when there were no requests. */
  p95Ms: z.number().min(0).nullable(),
  /** Share of requests answered 5xx, 0 to 1; null without requests. */
  errorRate: z.number().min(0).max(1).nullable(),
  /** Share answered 4xx (sign-in expiry, validation): context, never an alert. */
  clientErrorRate: z.number().min(0).max(1).nullable(),
  /** Jobs waiting across every queue; null when the worker recorded nothing. */
  queueWaiting: z.number().int().min(0).nullable(),
  storageBytes: z.number().int().min(0).nullable(),
});
export type MetricsPoint = z.infer<typeof metricsPointSchema>;

export const slowEndpointSchema = z.object({
  /** e.g. "GET /api/v1/documents/:documentId" */
  route: z.string(),
  requests: z.number().int().min(0),
  avgMs: z.number().min(0),
  p95Ms: z.number().min(0),
  maxMs: z.number().min(0),
});
export type SlowEndpoint = z.infer<typeof slowEndpointSchema>;

/** A database query over SLOW_QUERY_MS, with the route that ran it (never its values). */
export const slowQuerySchema = z.object({
  at: z.iso.datetime(),
  route: z.string(),
  durationMs: z.number().min(0),
  query: z.string(),
});
export type SlowQuery = z.infer<typeof slowQuerySchema>;

export const systemMetricsSchema = z
  .object({
    range: metricsRangeSchema,
    bucketMinutes: z.number().int().min(1),
    points: z.array(metricsPointSchema),
    /** Distinct accounts signed in per Manila day, the last 7 days, oldest first. */
    activeUsers: z.array(
      z.object({ day: z.iso.date(), users: z.number().int().min(0) }),
    ),
    slowestEndpoints: z.array(slowEndpointSchema),
    slowQueries: z.array(slowQuerySchema),
    totals: z.object({
      requests: z.number().int().min(0),
      errorRate: z.number().min(0).max(1).nullable(),
      p95Ms: z.number().min(0).nullable(),
    }),
    generatedAt: z.iso.datetime(),
  })
  .meta({ id: 'SystemMetrics' });
export type SystemMetrics = z.infer<typeof systemMetricsSchema>;

/** A database query slower than this is logged with its route and listed in /system/metrics. */
export const SLOW_QUERY_MS = 500;

/** What raises a console alert (and an email to every super admin). */
export const ALERT_KINDS = [
  'error_rate',
  'slow_responses',
  'worker_down',
  'disk_full',
  'clamav_outdated',
] as const;
export const alertKindSchema = z.enum(ALERT_KINDS);
export type AlertKind = z.infer<typeof alertKindSchema>;

export const systemAlertSchema = z.object({
  id: z.uuid(),
  kind: alertKindSchema,
  message: z.string(),
  openedAt: z.iso.datetime(),
});
export type SystemAlert = z.infer<typeof systemAlertSchema>;

/** GET /system/alerts: open alerts, oldest first. */
export const systemAlertsSchema = z
  .object({ alerts: z.array(systemAlertSchema) })
  .meta({ id: 'SystemAlerts' });
export type SystemAlerts = z.infer<typeof systemAlertsSchema>;

/** After an alert email, the same kind is not emailed again for this long. */
export const DEFAULT_ALERT_COOLDOWN_MINUTES = 30;
export const alertCooldownMinutesSchema = z
  .number({ error: 'Enter a number of minutes' })
  .int('Use whole minutes')
  .min(5, 'At least 5 minutes')
  .max(1440, 'At most 1,440 minutes (a day)');
