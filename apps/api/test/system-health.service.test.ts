import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import {
  createSystemHealthService,
  withTimeout,
  type HealthProbes,
  type SystemHealthServiceDeps,
} from '#src/services/system-health.service';

const NOW = new Date('2026-11-11T12:00:00Z');
const logger = pino({ level: 'silent' });

function healthyProbes(): HealthProbes {
  return {
    redis: () => Promise.resolve({ latencyMs: 2, usedMemoryBytes: 2048, maxMemoryBytes: 0 }),
    storage: () => Promise.resolve(),
    clamav: () => Promise.resolve({ engine: 'ClamAV 1.4.6', signaturesAt: new Date(NOW.getTime() - 3_600_000) }),
    smtp: () => Promise.resolve(),
    disk: () => Promise.resolve({ totalBytes: 1000, freeBytes: 600, usedRatio: 0.4 }),
    workerHeartbeat: () => Promise.resolve(new Date(NOW.getTime() - 10_000)),
    queues: () =>
      Promise.resolve([
        { name: 'documents', waiting: 2, active: 1, delayed: 0, failed: 0, oldestWaitingAt: new Date(NOW.getTime() - 60_000) },
        { name: 'previews', waiting: 1, active: 0, delayed: 0, failed: 0, oldestWaitingAt: null },
      ]),
  };
}

function healthyMetrics(): SystemHealthServiceDeps['metrics'] {
  return {
    ping: () => Promise.resolve(),
    databaseStats: () => Promise.resolve({ sizeBytes: 5_000_000, connections: 4, maxConnections: 100 }),
    cacheLookups: () => Promise.resolve({ hits: 75, misses: 25 }),
    eventLoopLag: () => Promise.resolve(12),
    storageByOrganization: () =>
      Promise.resolve([
        { slug: 'jpice', acronym: 'JPICE', name: 'JPICE', bytes: 3_000, files: 4 },
        { slug: 'issc', acronym: 'ISSC', name: 'ISSC', bytes: 1_000, files: 1 },
      ]),
  };
}

function build(over: Partial<SystemHealthServiceDeps> = {}) {
  return createSystemHealthService({
    probes: healthyProbes(),
    metrics: healthyMetrics(),
    process: { uptimeSeconds: () => 3_600, rssBytes: () => 100_000_000 },
    logger,
    now: () => NOW,
    cacheMs: 0,
    ...over,
  });
}

describe('system health', () => {
  it('reads green when every service answers, with its facts', async () => {
    const health = await build().check();
    expect(health.status).toBe('ok');
    expect(health.checks.every((c) => c.status === 'ok')).toBe(true);

    const fact = (id: string, label: string) =>
      health.checks.find((c) => c.id === id)?.facts.find((f) => f.label === label)?.value;
    expect(fact('redis', 'Cache hit rate, 1 h')).toBe(0.75);
    expect(fact('worker', 'Jobs waiting')).toBe(3);
    expect(fact('worker', 'Oldest waiting since')).toBe(new Date(NOW.getTime() - 60_000).toISOString());
    expect(fact('postgres', 'Connections')).toBe('4 of 100');
    expect(fact('storage', 'Stored originals')).toBe(4_000);
    expect(fact('storage', 'Files')).toBe(5);
    expect(health.storageByOrganization.map((o) => o.slug)).toEqual(['jpice', 'issc']);
  });

  it('reads a probe that throws as down, and the whole as its worst', async () => {
    const health = await build({
      probes: { ...healthyProbes(), smtp: () => Promise.reject(new Error('ECONNREFUSED')) },
    }).check();
    const email = health.checks.find((c) => c.id === 'email')!;
    expect(email).toMatchObject({ status: 'down', facts: [] });
    expect(email.summary).toMatch(/mail relay cannot be reached/);
    expect(health.status).toBe('down');
  });

  it('reads a probe that hangs as down after the timeout', async () => {
    const health = await build({
      probes: { ...healthyProbes(), clamav: () => new Promise(() => {}) },
      timeoutMs: 20,
    }).check();
    expect(health.checks.find((c) => c.id === 'clamav')?.status).toBe('down');
  });

  it('judges the worker from its heartbeat, and amber for a full disk at 80%', async () => {
    const health = await build({
      probes: {
        ...healthyProbes(),
        workerHeartbeat: () => Promise.resolve(null),
        disk: () => Promise.resolve({ totalBytes: 100, freeBytes: 20, usedRatio: 0.8 }),
      },
    }).check();
    expect(health.checks.find((c) => c.id === 'worker')?.status).toBe('down');
    expect(health.checks.find((c) => c.id === 'disk')?.status).toBe('warn');
  });

  it('shows no cache hit rate without lookups, and no storage list when it fails', async () => {
    const health = await build({
      metrics: {
        ...healthyMetrics(),
        cacheLookups: () => Promise.reject(new Error('down')),
        storageByOrganization: () => Promise.reject(new Error('down')),
      },
    }).check();
    const redis = health.checks.find((c) => c.id === 'redis')!;
    expect(redis.facts.find((f) => f.label === 'Cache hit rate, 1 h')?.value).toBeNull();
    expect(health.storageByOrganization).toEqual([]);
  });

  it('shares one round of probes between refreshes close together', async () => {
    const storage = vi.fn(() => Promise.resolve());
    const service = build({ probes: { ...healthyProbes(), storage }, cacheMs: 60_000 });
    await Promise.all([service.check(), service.check()]);
    await service.check();
    expect(storage).toHaveBeenCalledTimes(1);
  });
});

describe('withTimeout', () => {
  it('passes a quick answer through and rejects a slow one', async () => {
    await expect(withTimeout(Promise.resolve(1), 50)).resolves.toBe(1);
    await expect(withTimeout(new Promise(() => {}), 10)).rejects.toThrow(/timed out/);
  });
});
