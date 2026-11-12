import {
  addDays,
  manilaDate,
  METRICS_BUCKET_MINUTES,
  METRICS_RANGE_MINUTES,
  type MetricsPoint,
  type MetricsRange,
  type SystemMetrics,
} from '@orghive/shared';
import type { MinuteSnapshot } from '#src/lib/metrics';
import type { QueueState } from '#src/lib/queue';
import type { SystemMetricsRepository } from '#src/repositories/system-metrics.repository';

const MINUTE_MS = 60_000;
/** How long minutes are kept (the worker's daily prune). */
export const METRICS_RETENTION_DAYS = 7;
const SLOWEST_ENDPOINTS = 10;
const SLOW_QUERIES = 20;
const ACTIVE_USER_DAYS = 7;

/** The start of the minute `at` falls in. */
export function minuteOf(at: Date): Date {
  return new Date(Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS);
}

/**
 * The buckets a range draws, oldest first, each filled from `rows` or empty: a gap in the
 * chart shows the API was down or idle rather than joining the points around it.
 */
export function fillSeries(
  rows: readonly {
    bucket: Date;
    requests: number;
    clientErrors: number;
    serverErrors: number;
    p95Ms: number | null;
    queueWaiting: number | null;
    storageBytes: number | null;
  }[],
  since: Date,
  now: Date,
  bucketMinutes: number,
): MetricsPoint[] {
  const step = bucketMinutes * MINUTE_MS;
  const byBucket = new Map(rows.map((r) => [r.bucket.getTime(), r]));
  const points: MetricsPoint[] = [];
  for (let t = Math.floor(since.getTime() / step) * step; t <= now.getTime(); t += step) {
    const row = byBucket.get(t);
    const requests = row?.requests ?? 0;
    points.push({
      at: new Date(t).toISOString(),
      requestsPerMinute: Math.round((requests / bucketMinutes) * 10) / 10,
      p95Ms: row?.p95Ms === null || row?.p95Ms === undefined ? null : Math.round(row.p95Ms),
      errorRate: requests > 0 ? row!.serverErrors / requests : null,
      clientErrorRate: requests > 0 ? row!.clientErrors / requests : null,
      queueWaiting: row?.queueWaiting ?? null,
      storageBytes: row?.storageBytes ?? null,
    });
  }
  return points;
}

/** The last `days` Manila days ending today, each with its count (0 when nobody signed in). */
export function fillDays(
  rows: readonly { day: string; users: number }[],
  now: Date,
  days: number,
): { day: string; users: number }[] {
  const counts = new Map(rows.map((r) => [r.day, r.users]));
  const today = manilaDate(now);
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(today, i - (days - 1));
    return { day, users: counts.get(day) ?? 0 };
  });
}

export interface SystemMetricsServiceDeps {
  metrics: Pick<
    SystemMetricsRepository,
    | 'save'
    | 'prune'
    | 'series'
    | 'slowestEndpoints'
    | 'slowQueries'
    | 'activeUsersByDay'
    | 'storageTotal'
    | 'databaseStats'
  >;
  now?: () => Date;
}

export function createSystemMetricsService(deps: SystemMetricsServiceDeps) {
  const { metrics } = deps;
  const now = deps.now ?? (() => new Date());

  return {
    /** GET /system/metrics?range= */
    async read(range: MetricsRange): Promise<SystemMetrics> {
      const at = now();
      const bucketMinutes = METRICS_BUCKET_MINUTES[range];
      const since = new Date(at.getTime() - METRICS_RANGE_MINUTES[range] * MINUTE_MS);
      const usersSince = new Date(at.getTime() - (ACTIVE_USER_DAYS + 1) * 24 * 60 * MINUTE_MS);

      const [rows, slowestEndpoints, slowQueries, users] = await Promise.all([
        metrics.series(since, bucketMinutes),
        metrics.slowestEndpoints(since, SLOWEST_ENDPOINTS),
        metrics.slowQueries(since, SLOW_QUERIES),
        metrics.activeUsersByDay(usersSince),
      ]);

      const requests = rows.reduce((sum, r) => sum + r.requests, 0);
      const serverErrors = rows.reduce((sum, r) => sum + r.serverErrors, 0);
      const weighted = rows.filter((r) => r.p95Ms !== null && r.requests > 0);
      const weight = weighted.reduce((sum, r) => sum + r.requests, 0);

      return {
        range,
        bucketMinutes,
        points: fillSeries(rows, since, at, bucketMinutes),
        activeUsers: fillDays(users, at, ACTIVE_USER_DAYS),
        slowestEndpoints,
        slowQueries,
        totals: {
          requests,
          errorRate: requests > 0 ? serverErrors / requests : null,
          p95Ms:
            weight > 0
              ? Math.round(weighted.reduce((sum, r) => sum + r.p95Ms! * r.requests, 0) / weight)
              : null,
        },
        generatedAt: at.toISOString(),
      };
    },

    /** An API process's finished minute (`minute` is its start). */
    async recordApiMinute(source: string, minute: Date, snapshot: MinuteSnapshot): Promise<void> {
      await metrics.save({ minute, source, ...snapshot });
    },

    /**
     * The worker's minute: queues, stored bytes and the database's size. Each part that
     * fails is left empty rather than losing the rest.
     */
    async recordWorkerMinute(input: {
      queues: () => Promise<QueueState[]>;
      rssBytes: number;
      cpuPercent: number;
    }): Promise<void> {
      const [queues, storageBytes, database] = await Promise.all([
        input.queues().catch(() => null),
        metrics.storageTotal().catch(() => null),
        metrics.databaseStats().catch(() => null),
      ]);
      await metrics.save({
        minute: minuteOf(now()),
        source: 'worker',
        queueWaiting: queues ? queues.reduce((sum, q) => sum + q.waiting, 0) : null,
        queueFailed: queues ? queues.reduce((sum, q) => sum + q.failed, 0) : null,
        storageBytes,
        databaseBytes: database?.sizeBytes ?? null,
        rssBytes: input.rssBytes,
        cpuPercent: input.cpuPercent,
      });
    },

    /** Deletes minutes older than the retention; the worker runs it daily. */
    prune(): Promise<number> {
      return metrics.prune(new Date(now().getTime() - METRICS_RETENTION_DAYS * 24 * 60 * MINUTE_MS));
    },
  };
}

export type SystemMetricsService = ReturnType<typeof createSystemMetricsService>;
