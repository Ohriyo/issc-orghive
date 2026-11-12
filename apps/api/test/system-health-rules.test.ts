import { describe, expect, it } from 'vitest';
import {
  apiVerdict,
  clamavVerdict,
  diskVerdict,
  planAlerts,
  postgresVerdict,
  redisVerdict,
  shouldNotify,
  workerVerdict,
  worstStatus,
  type AlertInputs,
} from '#src/services/system-health-rules';

const NOW = new Date('2026-11-11T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

describe('worstStatus', () => {
  it('is the worst of the checks, ok for none', () => {
    expect(worstStatus([])).toBe('ok');
    expect(worstStatus(['ok', 'warn', 'ok'])).toBe('warn');
    expect(worstStatus(['warn', 'down', 'ok'])).toBe('down');
  });
});

describe('verdicts', () => {
  it('reads the API amber when its event loop falls behind', () => {
    expect(apiVerdict({ eventLoopLagMs: 20 }).status).toBe('ok');
    expect(apiVerdict({ eventLoopLagMs: 250 }).status).toBe('warn');
  });

  it('reads the database amber when slow or out of connections', () => {
    expect(postgresVerdict({ latencyMs: 5, connections: 10, maxConnections: 100 }).status).toBe('ok');
    expect(postgresVerdict({ latencyMs: 400, connections: 10, maxConnections: 100 }).status).toBe('warn');
    expect(postgresVerdict({ latencyMs: 5, connections: 90, maxConnections: 100 }).status).toBe('warn');
  });

  it('reads Redis amber near its memory limit, never without one', () => {
    expect(redisVerdict({ latencyMs: 1, usedMemoryBytes: 900, maxMemoryBytes: 1000 }).status).toBe('warn');
    expect(redisVerdict({ latencyMs: 1, usedMemoryBytes: 900, maxMemoryBytes: 0 }).status).toBe('ok');
    expect(redisVerdict({ latencyMs: 300, usedMemoryBytes: 1, maxMemoryBytes: 0 }).status).toBe('warn');
  });

  it('reads the worker red without a recent heartbeat, amber when behind or failing', () => {
    const fresh = { heartbeatAt: ago(30_000), failed: 0, oldestWaitingAt: null };
    expect(workerVerdict(fresh, NOW).status).toBe('ok');
    expect(workerVerdict({ ...fresh, heartbeatAt: null }, NOW).status).toBe('down');
    expect(workerVerdict({ ...fresh, heartbeatAt: ago(3 * MIN) }, NOW).status).toBe('down');
    expect(workerVerdict({ ...fresh, oldestWaitingAt: ago(11 * MIN) }, NOW).status).toBe('warn');
    expect(workerVerdict({ ...fresh, failed: 2 }, NOW).status).toBe('warn');
  });

  it('reads ClamAV amber with old or unknown signatures', () => {
    expect(clamavVerdict(ago(DAY), NOW).status).toBe('ok');
    expect(clamavVerdict(ago(4 * DAY), NOW).status).toBe('warn');
    expect(clamavVerdict(null, NOW).status).toBe('warn');
  });

  it('reads the disk amber past 75% and red past 85%', () => {
    expect(diskVerdict(0.5).status).toBe('ok');
    expect(diskVerdict(0.8).status).toBe('warn');
    expect(diskVerdict(0.9).status).toBe('down');
  });
});

describe('planAlerts', () => {
  const calm: AlertInputs = {
    now: NOW,
    traffic: { requests: 500, serverErrors: 2, p95Ms: 300 },
    workerHeartbeatAt: ago(20_000),
    diskUsedRatio: 0.5,
    clamavSignaturesAt: ago(DAY),
  };

  it('opens nothing when all is well', () => {
    expect(planAlerts(calm)).toEqual({});
  });

  it('opens each alert when its condition holds', () => {
    const plan = planAlerts({
      now: NOW,
      traffic: { requests: 100, serverErrors: 9, p95Ms: 2_500 },
      workerHeartbeatAt: ago(5 * MIN),
      diskUsedRatio: 0.9,
      clamavSignaturesAt: ago(4 * DAY),
    });
    expect(Object.keys(plan).sort()).toEqual([
      'clamav_outdated',
      'disk_full',
      'error_rate',
      'slow_responses',
      'worker_down',
    ]);
    expect(plan.error_rate).toContain('9%');
    expect(plan.slow_responses).toContain('2.5 s');
    expect(plan.disk_full).toContain('90%');
  });

  it('needs enough traffic to judge errors and latency', () => {
    expect(planAlerts({ ...calm, traffic: { requests: 5, serverErrors: 3, p95Ms: 9_000 } })).toEqual({});
  });

  it('treats a missing heartbeat as a stopped worker, and unknown disk or ClamAV as fine', () => {
    const plan = planAlerts({ ...calm, workerHeartbeatAt: null, diskUsedRatio: null, clamavSignaturesAt: null });
    expect(Object.keys(plan)).toEqual(['worker_down']);
  });
});

describe('shouldNotify', () => {
  it('emails the first time, then not again within the cooldown', () => {
    expect(shouldNotify(null, NOW, 30)).toBe(true);
    expect(shouldNotify(ago(10 * MIN), NOW, 30)).toBe(false);
    expect(shouldNotify(ago(30 * MIN), NOW, 30)).toBe(true);
  });
});
