import { describe, expect, it, vi } from 'vitest';
import type { MetricRow } from '#src/repositories/system-metrics.repository';
import {
  createSystemMetricsService,
  fillDays,
  fillSeries,
  minuteOf,
  type SystemMetricsServiceDeps,
} from '#src/services/system-metrics.service';

const NOW = new Date('2026-11-11T12:00:30Z');

function repo(over: Partial<SystemMetricsServiceDeps['metrics']> = {}) {
  const saved: MetricRow[] = [];
  const metrics: SystemMetricsServiceDeps['metrics'] = {
    save: (row) => {
      saved.push(row);
      return Promise.resolve();
    },
    prune: vi.fn(() => Promise.resolve(42)),
    series: () => Promise.resolve([]),
    slowestEndpoints: () => Promise.resolve([]),
    slowQueries: () => Promise.resolve([]),
    activeUsersByDay: () => Promise.resolve([]),
    storageTotal: () => Promise.resolve(9_000),
    databaseStats: () => Promise.resolve({ sizeBytes: 50_000, connections: 3, maxConnections: 100 }),
    ...over,
  };
  return { metrics, saved };
}

describe('minuteOf', () => {
  it('is the start of the minute', () => {
    expect(minuteOf(NOW).toISOString()).toBe('2026-11-11T12:00:00.000Z');
  });
});

describe('fillSeries', () => {
  it('draws every bucket, empty ones included, with rates per minute', () => {
    const since = new Date('2026-11-11T11:50:00Z');
    const points = fillSeries(
      [
        {
          bucket: new Date('2026-11-11T11:55:00Z'),
          requests: 50,
          clientErrors: 5,
          serverErrors: 1,
          p95Ms: 240.6,
          queueWaiting: 2,
          storageBytes: 100,
        },
      ],
      since,
      NOW,
      5,
    );
    expect(points.map((p) => p.at)).toEqual([
      '2026-11-11T11:50:00.000Z',
      '2026-11-11T11:55:00.000Z',
      '2026-11-11T12:00:00.000Z',
    ]);
    expect(points[0]).toMatchObject({ requestsPerMinute: 0, p95Ms: null, errorRate: null });
    expect(points[1]).toEqual({
      at: '2026-11-11T11:55:00.000Z',
      requestsPerMinute: 10,
      p95Ms: 241,
      errorRate: 0.02,
      clientErrorRate: 0.1,
      queueWaiting: 2,
      storageBytes: 100,
    });
  });
});

describe('fillDays', () => {
  it('lists the last days in Manila, oldest first, zero when nobody signed in', () => {
    // 12:00 UTC is 20:00 in Manila, still 11 November.
    expect(fillDays([{ day: '2026-11-10', users: 3 }], NOW, 3)).toEqual([
      { day: '2026-11-09', users: 0 },
      { day: '2026-11-10', users: 3 },
      { day: '2026-11-11', users: 0 },
    ]);
  });
});

describe('system metrics service', () => {
  it('reads a range: buckets, totals and the slow lists', async () => {
    const series = vi.fn(() =>
      Promise.resolve([
        { bucket: new Date('2026-11-11T11:30:00Z'), requests: 100, clientErrors: 0, serverErrors: 4, p95Ms: 300, queueWaiting: 0, storageBytes: 10 },
        { bucket: new Date('2026-11-11T11:31:00Z'), requests: 300, clientErrors: 0, serverErrors: 0, p95Ms: 100, queueWaiting: 0, storageBytes: 10 },
        { bucket: new Date('2026-11-11T11:32:00Z'), requests: 0, clientErrors: 0, serverErrors: 0, p95Ms: null, queueWaiting: 1, storageBytes: 10 },
      ]),
    );
    const { metrics } = repo({ series });
    const result = await createSystemMetricsService({ metrics, now: () => NOW }).read('1h');

    expect(series).toHaveBeenCalledWith(new Date(NOW.getTime() - 3_600_000), 1);
    expect(result.range).toBe('1h');
    expect(result.points.length).toBe(61);
    expect(result.totals).toEqual({ requests: 400, errorRate: 0.01, p95Ms: 150 });
    expect(result.activeUsers).toHaveLength(7);
    expect(result.generatedAt).toBe(NOW.toISOString());
  });

  it('has no totals without traffic', async () => {
    const { metrics } = repo();
    const result = await createSystemMetricsService({ metrics, now: () => NOW }).read('7d');
    expect(result.bucketMinutes).toBe(60);
    expect(result.totals).toEqual({ requests: 0, errorRate: null, p95Ms: null });
  });

  it('saves an API minute under its source', async () => {
    const { metrics, saved } = repo();
    const minute = new Date('2026-11-11T11:59:00Z');
    await createSystemMetricsService({ metrics }).recordApiMinute('api:host:1', minute, {
      requests: 3,
      clientErrors: 0,
      serverErrors: 0,
      p50Ms: 5,
      p95Ms: 9,
      p99Ms: 9,
      eventLoopLagMs: 1,
      rssBytes: 10,
      cpuPercent: 2,
      cacheHits: 1,
      cacheMisses: 0,
      routes: [],
      slowQueries: [],
    });
    expect(saved[0]).toMatchObject({ minute, source: 'api:host:1', requests: 3, p95Ms: 9 });
  });

  it('saves the worker minute, leaving out what it could not read', async () => {
    const { metrics, saved } = repo({ databaseStats: () => Promise.reject(new Error('down')) });
    await createSystemMetricsService({ metrics, now: () => NOW }).recordWorkerMinute({
      queues: () =>
        Promise.resolve([
          { name: 'documents', waiting: 3, active: 0, delayed: 0, failed: 1, oldestWaitingAt: null },
          { name: 'previews', waiting: 2, active: 0, delayed: 0, failed: 0, oldestWaitingAt: null },
        ]),
      rssBytes: 500,
      cpuPercent: 4,
    });
    expect(saved[0]).toEqual({
      minute: new Date('2026-11-11T12:00:00Z'),
      source: 'worker',
      queueWaiting: 5,
      queueFailed: 1,
      storageBytes: 9_000,
      databaseBytes: null,
      rssBytes: 500,
      cpuPercent: 4,
    });

    const failing = repo();
    await createSystemMetricsService({ metrics: failing.metrics, now: () => NOW }).recordWorkerMinute({
      queues: () => Promise.reject(new Error('redis')),
      rssBytes: 1,
      cpuPercent: 0,
    });
    expect(failing.saved[0]).toMatchObject({ queueWaiting: null, queueFailed: null });
  });

  it('prunes minutes older than 7 days', async () => {
    const { metrics } = repo();
    expect(await createSystemMetricsService({ metrics, now: () => NOW }).prune()).toBe(42);
    expect(metrics.prune).toHaveBeenCalledWith(new Date(NOW.getTime() - 7 * 24 * 3_600_000));
  });
});
