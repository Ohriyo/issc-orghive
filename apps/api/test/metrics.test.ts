import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMetrics,
  currentRoute,
  MAX_SLOW_QUERIES_PER_SNAPSHOT,
  normalizePath,
  percentile,
  QUERY_TEXT_MAX,
  routeGroup,
  type Metrics,
  type RequestSample,
} from '#src/lib/metrics';
import { metricsMiddleware } from '#src/middleware/metrics';
import { parseClamavVersion, parseRedisInfo } from '#src/lib/system-probes';

const sample = (over: Partial<RequestSample> = {}): RequestSample => ({
  method: 'GET',
  route: 'GET /api/v1/documents/:documentId',
  group: 'documents',
  status: 200,
  durationMs: 10,
  ...over,
});

let metrics: Metrics | undefined;
afterEach(() => metrics?.stop());

describe('percentile', () => {
  it('takes the nearest rank, null for nothing', () => {
    expect(percentile([], 0.95)).toBeNull();
    expect(percentile([5], 0.5)).toBe(5);
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 0.5)).toBe(50);
    expect(percentile(values, 0.95)).toBe(95);
    expect(percentile(values, 0.99)).toBe(99);
  });
});

describe('normalizePath and routeGroup', () => {
  it('folds ids and tokens so one path never becomes thousands', () => {
    expect(normalizePath('/api/v1/documents/0195f4a2-7c1e-7b3a-9d2e-1234567890ab/pages/3?token=x')).toBe(
      '/api/v1/documents/:id/pages/:n',
    );
    expect(normalizePath(`/api/v1/x/${'a'.repeat(50)}`)).toBe('/api/v1/x/:token');
  });

  it('groups by the first segment after /api/v1', () => {
    expect(routeGroup('/api/v1/system/health')).toBe('system');
    expect(routeGroup('/health')).toBe('health');
    expect(routeGroup('/')).toBe('other');
  });
});

describe('createMetrics', () => {
  it('summarizes a minute and starts a fresh one', () => {
    metrics = createMetrics({ defaultMetrics: false, random: () => 0 });
    for (let i = 1; i <= 100; i += 1) metrics.recordRequest(sample({ durationMs: i }));
    metrics.recordRequest(sample({ route: 'POST /api/v1/uploads', status: 500, durationMs: 900 }));
    metrics.recordRequest(sample({ status: 404, durationMs: 1 }));
    metrics.recordCacheLookup(true);
    metrics.recordCacheLookup(false);
    metrics.recordCacheLookup(true);

    const snap = metrics.takeSnapshot();
    expect(snap).toMatchObject({
      requests: 102,
      clientErrors: 1,
      serverErrors: 1,
      p50Ms: 50,
      cacheHits: 2,
      cacheMisses: 1,
    });
    expect(snap.p99Ms).toBeGreaterThanOrEqual(99);
    // Slowest route first.
    expect(snap.routes[0]).toMatchObject({ route: 'POST /api/v1/uploads', count: 1, maxMs: 900 });
    expect(snap.rssBytes).toBeGreaterThan(0);

    const next = metrics.takeSnapshot();
    expect(next).toMatchObject({ requests: 0, p95Ms: null, routes: [], slowQueries: [] });
  });

  it('keeps only slow queries, slowest first, cut short and capped', () => {
    metrics = createMetrics({ defaultMetrics: false });
    expect(metrics.recordQuery({ route: 'r', durationMs: 10, query: 'SELECT 1' })).toBe(false);
    for (let i = 0; i < 60; i += 1) {
      metrics.recordQuery({ route: 'r', durationMs: 500 + i, query: 'x'.repeat(1_000) });
    }
    const { slowQueries } = metrics.takeSnapshot();
    expect(slowQueries).toHaveLength(MAX_SLOW_QUERIES_PER_SNAPSHOT);
    expect(slowQueries[0]!.durationMs).toBe(559);
    expect(slowQueries[0]!.query).toHaveLength(QUERY_TEXT_MAX);
  });

  it('serves Prometheus text with the request histogram', async () => {
    metrics = createMetrics({ defaultMetrics: false, labels: { instance: 'test' } });
    metrics.recordRequest(sample({ durationMs: 120 }));
    const text = await metrics.registry.metrics();
    expect(text).toMatch(
      /^orghive_http_request_duration_seconds_count\{(?=[^}]*instance="test")(?=[^}]*group="documents")(?=[^}]*status_class="2xx")[^}]*\} 1$/m,
    );
  });
});

describe('metricsMiddleware', () => {
  function app(recorded: RequestSample[]) {
    const server = express();
    server.use(metricsMiddleware({ recordRequest: (s) => recorded.push(s) }));
    const router = express.Router();
    router.get('/documents/:documentId', (_req, res) => {
      res.json({ route: currentRoute() });
    });
    router.get('/broken', () => {
      throw new Error('boom');
    });
    router.get('/stream', (_req, res) => {
      res.end();
    });
    const v1 = express.Router();
    v1.use(router);
    server.use('/api/v1', v1);
    server.get('/health', (_req, res) => {
      res.end();
    });
    return server;
  }

  it('records the matched route, and queries see it through the request scope', async () => {
    const recorded: RequestSample[] = [];
    const res = await request(app(recorded)).get('/api/v1/documents/abc').expect(200);
    expect(res.body).toEqual({ route: 'GET /api/v1/documents/:documentId' });
    expect(recorded).toEqual([
      expect.objectContaining({
        route: 'GET /api/v1/documents/:documentId',
        group: 'documents',
        status: 200,
      }),
    ]);
  });

  it('records errors and unknown paths, and skips streams and health checks', async () => {
    const recorded: RequestSample[] = [];
    const server = app(recorded);
    await request(server).get('/api/v1/broken').expect(500);
    await request(server).get('/api/v1/nothing/0195f4a2-7c1e-7b3a-9d2e-1234567890ab').expect(404);
    await request(server).get('/api/v1/stream').expect(200);
    await request(server).get('/health').expect(200);

    expect(recorded.map((s) => [s.route, s.status])).toEqual([
      ['GET /api/v1/broken', 500],
      ['GET /api/v1/nothing/:id', 404],
    ]);
  });

  it('reads "background" outside a request', () => {
    expect(currentRoute()).toBe('background');
  });
});

describe('probe parsers', () => {
  it('reads ClamAV’s engine and signature date', () => {
    expect(parseClamavVersion('ClamAV 1.4.6/28180/Wed Nov 11 06:24:27 2026\0')).toEqual({
      engine: 'ClamAV 1.4.6',
      signaturesAt: new Date('2026-11-11T06:24:27Z'),
    });
    expect(parseClamavVersion('ClamAV 1.4.6')).toEqual({ engine: 'ClamAV 1.4.6', signaturesAt: null });
  });

  it('reads Redis INFO fields', () => {
    expect(parseRedisInfo('# Memory\r\nused_memory:1024\r\nmaxmemory:0\r\n')).toEqual({
      used_memory: '1024',
      maxmemory: '0',
    });
  });
});
