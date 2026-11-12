import { AsyncLocalStorage } from 'node:async_hooks';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from '@prometheus-io/client';
import { SLOW_QUERY_MS } from '@orghive/shared';

/*
 * The API's own measurements (/system/metrics). Two views of the same requests:
 * - a Prometheus registry, served on the internal metrics port only (never the public one);
 * - a 1-minute window the snapshot recorder flushes to `system_metrics`, so the console can
 *   chart history without a Prometheus server.
 */

/** One request, measured when its response finished. */
export interface RequestSample {
  method: string;
  /** "GET /api/v1/documents/:documentId", or a normalized path when no route matched. */
  route: string;
  /** "documents", "system"…: the first path segment after /api/v1. */
  group: string;
  status: number;
  durationMs: number;
}

export interface RouteStats {
  route: string;
  count: number;
  totalMs: number;
  maxMs: number;
  p95Ms: number;
}

export interface SlowQuerySample {
  route: string;
  durationMs: number;
  /** SQL text with placeholders, cut to QUERY_TEXT_MAX; parameter values are never kept. */
  query: string;
}

/** What one API process measured in one minute. */
export interface MinuteSnapshot {
  requests: number;
  clientErrors: number;
  serverErrors: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  eventLoopLagMs: number;
  rssBytes: number;
  cpuPercent: number;
  cacheHits: number;
  cacheMisses: number;
  /** Slowest first, at most MAX_ROUTES_PER_SNAPSHOT. */
  routes: RouteStats[];
  /** Slowest first, at most MAX_SLOW_QUERIES_PER_SNAPSHOT. */
  slowQueries: SlowQuerySample[];
}

/** Durations kept per minute for the percentiles (reservoir sampling past this). */
const RESERVOIR = 5_000;
const ROUTE_RESERVOIR = 500;
/** Distinct routes tracked per minute; any more are counted as "other". */
const MAX_ROUTES = 300;
export const MAX_ROUTES_PER_SNAPSHOT = 40;
export const MAX_SLOW_QUERIES_PER_SNAPSHOT = 20;
export const QUERY_TEXT_MAX = 300;

/** The p-th percentile (0 to 1) of ascending values, nearest rank; null for none. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

/** Keeps at most `size` values, each seen value equally likely to stay (Algorithm R). */
class Reservoir {
  private values: number[] = [];
  private seen = 0;
  constructor(
    private readonly size: number,
    private readonly random: () => number,
  ) {}
  add(value: number) {
    this.seen += 1;
    if (this.values.length < this.size) {
      this.values.push(value);
      return;
    }
    const slot = Math.floor(this.random() * this.seen);
    if (slot < this.size) this.values[slot] = value;
  }
  sorted(): number[] {
    return [...this.values].sort((a, b) => a - b);
  }
}

interface RouteWindow {
  count: number;
  totalMs: number;
  maxMs: number;
  durations: Reservoir;
}

interface Window {
  requests: number;
  clientErrors: number;
  serverErrors: number;
  durations: Reservoir;
  routes: Map<string, RouteWindow>;
  cacheHits: number;
  cacheMisses: number;
  slowQueries: SlowQuerySample[];
}

/**
 * Turns a request path into a route when Express matched none (404s, errors before
 * routing): ids and long tokens become placeholders, so one path never becomes thousands.
 */
export function normalizePath(path: string): string {
  return path
    .split('?')[0]!
    .split('/')
    .map((segment) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)
        ? ':id'
        : /^\d+$/.test(segment)
          ? ':n'
          : segment.length > 40
            ? ':token'
            : segment,
    )
    .join('/');
}

/** "documents" for /api/v1/documents/…, "health" for /health, "other" otherwise. */
export function routeGroup(path: string): string {
  const match = /^\/api\/v1\/([^/?]+)/.exec(path) ?? /^\/([^/?]+)/.exec(path);
  return match?.[1] ?? 'other';
}

export interface MetricsOptions {
  /** Static labels on every Prometheus series, e.g. the instance. */
  labels?: Record<string, string>;
  random?: () => number;
  /** Default metrics (CPU, memory, event loop) on; tests turn them off. */
  defaultMetrics?: boolean;
}

export function createMetrics(options: MetricsOptions = {}) {
  const random = options.random ?? Math.random;
  const registry = new Registry();
  if (options.labels) registry.setDefaultLabels(options.labels);
  if (options.defaultMetrics !== false) collectDefaultMetrics({ register: registry });

  const httpDuration = new Histogram({
    name: 'orghive_http_request_duration_seconds',
    help: 'API request duration in seconds, by route group and status class',
    labelNames: ['method', 'group', 'status_class'],
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
    registers: [registry],
  });
  const cacheLookups = new Counter({
    name: 'orghive_cache_lookups_total',
    help: 'Redis cache-aside lookups, by result',
    labelNames: ['result'],
    registers: [registry],
  });
  const slowQueryCount = new Counter({
    name: 'orghive_slow_queries_total',
    help: `Database queries slower than ${SLOW_QUERY_MS} ms`,
    registers: [registry],
  });

  const loopDelay = monitorEventLoopDelay({ resolution: 20 });
  loopDelay.enable();
  let cpuMark = process.cpuUsage();
  let wallMark = performance.now();

  const fresh = (): Window => ({
    requests: 0,
    clientErrors: 0,
    serverErrors: 0,
    durations: new Reservoir(RESERVOIR, random),
    routes: new Map(),
    cacheHits: 0,
    cacheMisses: 0,
    slowQueries: [],
  });
  let window = fresh();

  return {
    registry,

    recordRequest(sample: RequestSample) {
      httpDuration.observe(
        {
          method: sample.method,
          group: sample.group,
          status_class: `${Math.floor(sample.status / 100)}xx`,
        },
        sample.durationMs / 1000,
      );
      window.requests += 1;
      if (sample.status >= 500) window.serverErrors += 1;
      else if (sample.status >= 400) window.clientErrors += 1;
      window.durations.add(sample.durationMs);

      const key =
        window.routes.has(sample.route) || window.routes.size < MAX_ROUTES
          ? sample.route
          : 'other';
      let route = window.routes.get(key);
      if (!route) {
        route = { count: 0, totalMs: 0, maxMs: 0, durations: new Reservoir(ROUTE_RESERVOIR, random) };
        window.routes.set(key, route);
      }
      route.count += 1;
      route.totalMs += sample.durationMs;
      route.maxMs = Math.max(route.maxMs, sample.durationMs);
      route.durations.add(sample.durationMs);
    },

    recordCacheLookup(hit: boolean) {
      cacheLookups.inc({ result: hit ? 'hit' : 'miss' });
      if (hit) window.cacheHits += 1;
      else window.cacheMisses += 1;
    },

    /** Every query; only those over SLOW_QUERY_MS are kept. True when it was slow. */
    recordQuery(sample: SlowQuerySample): boolean {
      if (sample.durationMs < SLOW_QUERY_MS) return false;
      slowQueryCount.inc();
      window.slowQueries.push({ ...sample, query: sample.query.slice(0, QUERY_TEXT_MAX) });
      if (window.slowQueries.length > MAX_SLOW_QUERIES_PER_SNAPSHOT * 2) {
        window.slowQueries.sort((a, b) => b.durationMs - a.durationMs);
        window.slowQueries.length = MAX_SLOW_QUERIES_PER_SNAPSHOT;
      }
      return true;
    },

    /** The minute so far, and a fresh one started. */
    takeSnapshot(): MinuteSnapshot {
      const done = window;
      window = fresh();

      const sorted = done.durations.sorted();
      const routes = [...done.routes.entries()]
        .map(([route, stats]) => ({
          route,
          count: stats.count,
          totalMs: round(stats.totalMs),
          maxMs: round(stats.maxMs),
          p95Ms: round(percentile(stats.durations.sorted(), 0.95) ?? 0),
        }))
        .sort((a, b) => b.p95Ms - a.p95Ms)
        .slice(0, MAX_ROUTES_PER_SNAPSHOT);

      const wallNow = performance.now();
      const cpu = process.cpuUsage(cpuMark);
      const elapsedMs = Math.max(1, wallNow - wallMark);
      cpuMark = process.cpuUsage();
      wallMark = wallNow;
      const lagMs = loopDelay.count > 0 ? loopDelay.percentile(99) / 1e6 : 0;
      loopDelay.reset();

      return {
        requests: done.requests,
        clientErrors: done.clientErrors,
        serverErrors: done.serverErrors,
        p50Ms: roundOrNull(percentile(sorted, 0.5)),
        p95Ms: roundOrNull(percentile(sorted, 0.95)),
        p99Ms: roundOrNull(percentile(sorted, 0.99)),
        eventLoopLagMs: round(lagMs),
        rssBytes: process.memoryUsage.rss(),
        cpuPercent: round(((cpu.user + cpu.system) / 1000 / elapsedMs) * 100),
        cacheHits: done.cacheHits,
        cacheMisses: done.cacheMisses,
        routes,
        slowQueries: done.slowQueries
          .sort((a, b) => b.durationMs - a.durationMs)
          .slice(0, MAX_SLOW_QUERIES_PER_SNAPSHOT)
          .map((q) => ({ ...q, durationMs: round(q.durationMs) })),
      };
    },

    stop() {
      loopDelay.disable();
    },
  };
}

export type Metrics = ReturnType<typeof createMetrics>;

const round = (value: number) => Math.round(value * 10) / 10;
const roundOrNull = (value: number | null) => (value === null ? null : round(value));

/**
 * The request a database query runs for, so a slow query is logged with its route. The
 * metrics middleware opens the scope; Prisma's query events fire inside it (checked: plain
 * queries, batches and interactive transactions).
 */
export interface RequestScope {
  method: string;
  /** Resolved lazily: the route is only known once Express has matched it. */
  route: () => string;
}

export const requestScope = new AsyncLocalStorage<RequestScope>();

/** The route of the request running now, or "background" outside one (startup, timers). */
export function currentRoute(): string {
  return requestScope.getStore()?.route() ?? 'background';
}
