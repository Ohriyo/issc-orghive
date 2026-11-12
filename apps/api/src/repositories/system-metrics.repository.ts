import type { OrganizationStorage, SlowEndpoint, SlowQuery } from '@orghive/shared';
import type { Prisma } from '#src/generated/prisma/client';
import type { Db } from './prisma';

/** One process's minute, as the recorder and the worker write it. */
export interface MetricRow {
  minute: Date;
  source: string;
  requests?: number;
  clientErrors?: number;
  serverErrors?: number;
  p50Ms?: number | null;
  p95Ms?: number | null;
  p99Ms?: number | null;
  eventLoopLagMs?: number | null;
  rssBytes?: number | null;
  cpuPercent?: number | null;
  cacheHits?: number;
  cacheMisses?: number;
  queueWaiting?: number | null;
  queueFailed?: number | null;
  storageBytes?: number | null;
  databaseBytes?: number | null;
  routes?: unknown[] | null;
  slowQueries?: unknown[] | null;
}

export interface SeriesRow {
  bucket: Date;
  requests: number;
  clientErrors: number;
  serverErrors: number;
  /** Request-weighted p95 of the API rows in the bucket. */
  p95Ms: number | null;
  queueWaiting: number | null;
  storageBytes: number | null;
}

const big = (value: number | null | undefined) =>
  value === null || value === undefined ? value : BigInt(Math.round(value));
const json = (value: unknown[] | null | undefined) =>
  value === undefined ? undefined : value === null ? undefined : (value as Prisma.InputJsonValue);
const num = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

/** API rows: "api:<host>:<pid>". */
const API_SOURCES = 'api:%';

export function createSystemMetricsRepository(db: Db) {
  return {
    /** Writes a process's minute; a second write of the same minute replaces it. */
    async save(row: MetricRow): Promise<void> {
      const data = {
        requests: row.requests,
        clientErrors: row.clientErrors,
        serverErrors: row.serverErrors,
        p50Ms: row.p50Ms,
        p95Ms: row.p95Ms,
        p99Ms: row.p99Ms,
        eventLoopLagMs: row.eventLoopLagMs,
        rssBytes: big(row.rssBytes),
        cpuPercent: row.cpuPercent,
        cacheHits: row.cacheHits,
        cacheMisses: row.cacheMisses,
        queueWaiting: row.queueWaiting,
        queueFailed: row.queueFailed,
        storageBytes: big(row.storageBytes),
        databaseBytes: big(row.databaseBytes),
        routes: json(row.routes),
        slowQueries: json(row.slowQueries),
      };
      await db.systemMetric.upsert({
        where: { minute_source: { minute: row.minute, source: row.source } },
        create: { minute: row.minute, source: row.source, ...data },
        update: data,
      });
    },

    /** Minutes older than `before` are deleted; returns how many rows went. */
    async prune(before: Date): Promise<number> {
      const { count } = await db.systemMetric.deleteMany({ where: { minute: { lt: before } } });
      return count;
    },

    /** The charts' series: one row per bucket that has data, oldest first. */
    async series(since: Date, bucketMinutes: number): Promise<SeriesRow[]> {
      const interval = `${bucketMinutes} minutes`;
      const rows = await db.$queryRaw<
        {
          bucket: Date;
          requests: bigint | null;
          client_errors: bigint | null;
          server_errors: bigint | null;
          p95_ms: number | null;
          queue_waiting: number | null;
          storage_bytes: bigint | null;
        }[]
      >`
        SELECT date_bin(${interval}::interval, minute, TIMESTAMP '2000-01-01') AS bucket,
               SUM(requests) FILTER (WHERE source LIKE ${API_SOURCES}) AS requests,
               SUM(client_errors) FILTER (WHERE source LIKE ${API_SOURCES}) AS client_errors,
               SUM(server_errors) FILTER (WHERE source LIKE ${API_SOURCES}) AS server_errors,
               SUM(p95_ms * requests) FILTER (WHERE p95_ms IS NOT NULL)
                 / NULLIF(SUM(requests) FILTER (WHERE p95_ms IS NOT NULL), 0) AS p95_ms,
               MAX(queue_waiting) AS queue_waiting,
               MAX(storage_bytes) AS storage_bytes
        FROM system_metrics
        WHERE minute >= ${since}
        GROUP BY 1
        ORDER BY 1`;
      return rows.map((r) => ({
        bucket: r.bucket,
        requests: Number(r.requests ?? 0),
        clientErrors: Number(r.client_errors ?? 0),
        serverErrors: Number(r.server_errors ?? 0),
        p95Ms: num(r.p95_ms),
        queueWaiting: num(r.queue_waiting),
        storageBytes: num(r.storage_bytes),
      }));
    },

    /** API traffic since `since`, summed across instances (the alert window). */
    async traffic(since: Date): Promise<{ requests: number; serverErrors: number; p95Ms: number | null }> {
      const [row] = await db.$queryRaw<
        { requests: bigint | null; server_errors: bigint | null; p95_ms: number | null }[]
      >`
        SELECT SUM(requests) AS requests,
               SUM(server_errors) AS server_errors,
               SUM(p95_ms * requests) FILTER (WHERE p95_ms IS NOT NULL)
                 / NULLIF(SUM(requests) FILTER (WHERE p95_ms IS NOT NULL), 0) AS p95_ms
        FROM system_metrics
        WHERE minute >= ${since} AND source LIKE ${API_SOURCES}`;
      return {
        requests: Number(row?.requests ?? 0),
        serverErrors: Number(row?.server_errors ?? 0),
        p95Ms: num(row?.p95_ms),
      };
    },

    /** Cache lookups since `since`, across API instances. */
    async cacheLookups(since: Date): Promise<{ hits: number; misses: number }> {
      const totals = await db.systemMetric.aggregate({
        where: { minute: { gte: since }, source: { startsWith: 'api:' } },
        _sum: { cacheHits: true, cacheMisses: true },
      });
      return { hits: totals._sum.cacheHits ?? 0, misses: totals._sum.cacheMisses ?? 0 };
    },

    /** The worst event-loop delay any API instance recorded since `since`; null for none. */
    async eventLoopLag(since: Date): Promise<number | null> {
      const totals = await db.systemMetric.aggregate({
        where: { minute: { gte: since }, source: { startsWith: 'api:' } },
        _max: { eventLoopLagMs: true },
      });
      return totals._max.eventLoopLagMs;
    },

    /** Routes by request-weighted p95, slowest first. */
    async slowestEndpoints(since: Date, limit: number): Promise<SlowEndpoint[]> {
      const rows = await db.$queryRaw<
        { route: string; requests: bigint; avg_ms: number; p95_ms: number; max_ms: number }[]
      >`
        SELECT r->>'route' AS route,
               SUM((r->>'count')::int) AS requests,
               SUM((r->>'totalMs')::float8) / NULLIF(SUM((r->>'count')::int), 0) AS avg_ms,
               SUM((r->>'p95Ms')::float8 * (r->>'count')::int) / NULLIF(SUM((r->>'count')::int), 0) AS p95_ms,
               MAX((r->>'maxMs')::float8) AS max_ms
        FROM system_metrics, jsonb_array_elements(routes) AS r
        WHERE minute >= ${since} AND routes IS NOT NULL
        GROUP BY 1
        ORDER BY p95_ms DESC NULLS LAST
        LIMIT ${limit}`;
      return rows.map((r) => ({
        route: r.route,
        requests: Number(r.requests),
        avgMs: Math.round(Number(r.avg_ms ?? 0)),
        p95Ms: Math.round(Number(r.p95_ms ?? 0)),
        maxMs: Math.round(Number(r.max_ms ?? 0)),
      }));
    },

    /** Queries over SLOW_QUERY_MS, slowest first. */
    async slowQueries(since: Date, limit: number): Promise<SlowQuery[]> {
      const rows = await db.$queryRaw<
        { minute: Date; route: string; duration_ms: number; query: string }[]
      >`
        SELECT minute, q->>'route' AS route, (q->>'durationMs')::float8 AS duration_ms, q->>'query' AS query
        FROM system_metrics, jsonb_array_elements(slow_queries) AS q
        WHERE minute >= ${since} AND slow_queries IS NOT NULL
        ORDER BY duration_ms DESC
        LIMIT ${limit}`;
      return rows.map((r) => ({
        at: r.minute.toISOString(),
        route: r.route,
        durationMs: Math.round(Number(r.duration_ms)),
        query: r.query,
      }));
    },

    /**
     * Distinct accounts that signed in or refreshed their session, per Manila day. Every
     * active session refreshes at least every 15 minutes, so this counts who used Orghive.
     */
    async activeUsersByDay(since: Date): Promise<{ day: string; users: number }[]> {
      const rows = await db.$queryRaw<{ day: string; users: bigint }[]>`
        SELECT to_char((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS day,
               COUNT(DISTINCT user_id) AS users
        FROM refresh_tokens
        WHERE created_at >= ${since}
        GROUP BY 1
        ORDER BY 1`;
      return rows.map((r) => ({ day: r.day, users: Number(r.users) }));
    },

    /** Bytes of every stored original (all versions); page images and logos are not counted. */
    async storageTotal(): Promise<number> {
      const totals = await db.documentVersion.aggregate({ _sum: { sizeBytes: true } });
      return totals._sum.sizeBytes ?? 0;
    },

    async storageByOrganization(): Promise<OrganizationStorage[]> {
      const rows = await db.$queryRaw<
        { slug: string; acronym: string; name: string; bytes: bigint; files: bigint }[]
      >`
        SELECT o.slug, o.acronym, o.name,
               COALESCE(SUM(v.size_bytes), 0) AS bytes,
               COUNT(v.id) AS files
        FROM organizations o
        LEFT JOIN documents d ON d.organization_id = o.id
        LEFT JOIN document_versions v ON v.document_id = d.id
        GROUP BY o.id
        ORDER BY bytes DESC, o.acronym`;
      return rows.map((r) => ({
        slug: r.slug,
        acronym: r.acronym,
        name: r.name,
        bytes: Number(r.bytes),
        files: Number(r.files),
      }));
    },

    /** Size and connections of this database; throws when it cannot be reached. */
    async databaseStats(): Promise<{ sizeBytes: number; connections: number; maxConnections: number }> {
      const [row] = await db.$queryRaw<
        { size: bigint; connections: bigint; max_connections: string }[]
      >`
        SELECT pg_database_size(current_database()) AS size,
               (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database()) AS connections,
               current_setting('max_connections') AS max_connections`;
      return {
        sizeBytes: Number(row?.size ?? 0),
        connections: Number(row?.connections ?? 0),
        maxConnections: Number(row?.max_connections ?? 0),
      };
    },

    async ping(): Promise<void> {
      await db.$queryRaw`SELECT 1`;
    },
  };
}

export type SystemMetricsRepository = ReturnType<typeof createSystemMetricsRepository>;
