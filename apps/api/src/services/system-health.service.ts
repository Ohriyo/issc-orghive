import type {
  HealthCheck,
  HealthCheckId,
  HealthFact,
  SystemHealth,
} from '@orghive/shared';
import type { QueueState } from '#src/lib/queue';
import type { ClamavVersion, DiskUsage, RedisStats } from '#src/lib/system-probes';
import type { Logger } from '#src/logger';
import type { SystemMetricsRepository } from '#src/repositories/system-metrics.repository';
import {
  apiVerdict,
  clamavVerdict,
  diskVerdict,
  postgresVerdict,
  redisVerdict,
  workerVerdict,
  worstStatus,
  type Verdict,
} from '#src/services/system-health-rules';

/** The live probes, each throwing when its service cannot be reached. */
export interface HealthProbes {
  redis: () => Promise<RedisStats>;
  storage: () => Promise<void>;
  clamav: () => Promise<ClamavVersion>;
  smtp: () => Promise<void>;
  disk: () => Promise<DiskUsage>;
  workerHeartbeat: () => Promise<Date | null>;
  queues: () => Promise<QueueState[]>;
}

export interface SystemHealthServiceDeps {
  probes: HealthProbes;
  metrics: Pick<
    SystemMetricsRepository,
    'ping' | 'databaseStats' | 'cacheLookups' | 'eventLoopLag' | 'storageByOrganization'
  >;
  /** This API process: uptime and memory. */
  process?: { uptimeSeconds: () => number; rssBytes: () => number };
  logger: Logger;
  now?: () => Date;
  /** A probe that takes longer reads as down. */
  timeoutMs?: number;
  /** Several tabs refreshing at once share one round of probes. */
  cacheMs?: number;
}

const HOUR_MS = 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

/** Rejects when `promise` takes longer than `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const fact = (label: string, value: HealthFact['value'], unit: HealthFact['unit']): HealthFact => ({
  label,
  value,
  unit,
});

const DOWN_SUMMARIES: Record<HealthCheckId, string> = {
  api: 'The API could not measure itself.',
  postgres: 'The database cannot be reached. Most pages fail until it is back.',
  redis: 'Redis cannot be reached. Pages load without cache and no jobs can be queued.',
  storage: 'File storage cannot be reached. Uploads, downloads and previews fail.',
  worker: 'The worker’s state cannot be read (Redis is unreachable).',
  clamav: 'ClamAV cannot be reached. Uploads stay in scanning until it is back.',
  email: 'The mail relay cannot be reached. Emails wait in their queue and retry.',
  disk: 'The disk could not be read.',
};

export function createSystemHealthService(deps: SystemHealthServiceDeps) {
  const { probes, metrics, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const timeoutMs = deps.timeoutMs ?? 3_000;
  const cacheMs = deps.cacheMs ?? 10_000;
  const proc = deps.process ?? {
    uptimeSeconds: () => process.uptime(),
    rssBytes: () => process.memoryUsage.rss(),
  };
  let cached: { at: number; result: Promise<SystemHealth> } | null = null;

  /** Runs one check; a probe that throws or times out reads as down, with the reason logged. */
  async function check(
    id: HealthCheckId,
    run: () => Promise<{ verdict: Verdict; facts: HealthFact[] }>,
  ): Promise<HealthCheck> {
    try {
      const { verdict, facts } = await withTimeout(run(), timeoutMs);
      return { id, ...verdict, checkedAt: now().toISOString(), facts };
    } catch (err) {
      logger.warn({ err, check: id }, 'Health check failed');
      return { id, status: 'down', summary: DOWN_SUMMARIES[id], checkedAt: now().toISOString(), facts: [] };
    }
  }

  async function run(): Promise<SystemHealth> {
    const at = now();
    const checks = await Promise.all([
      check('api', async () => {
        const lag = (await metrics.eventLoopLag(new Date(at.getTime() - FIVE_MINUTES_MS))) ?? 0;
        return {
          verdict: apiVerdict({ eventLoopLagMs: lag }),
          facts: [
            fact('Up for', Math.round(proc.uptimeSeconds()), 'seconds'),
            fact('Memory', proc.rssBytes(), 'bytes'),
            fact('Event-loop delay, 5 min', Math.round(lag), 'ms'),
          ],
        };
      }),
      check('postgres', async () => {
        const started = performance.now();
        await metrics.ping();
        const latencyMs = performance.now() - started;
        const stats = await metrics.databaseStats();
        return {
          verdict: postgresVerdict({ latencyMs, ...stats }),
          facts: [
            fact('Latency', Math.round(latencyMs), 'ms'),
            fact('Connections', `${stats.connections} of ${stats.maxConnections}`, 'text'),
            fact('Database size', stats.sizeBytes, 'bytes'),
          ],
        };
      }),
      check('redis', async () => {
        const stats = await probes.redis();
        const lookups = await metrics
          .cacheLookups(new Date(at.getTime() - HOUR_MS))
          .catch(() => ({ hits: 0, misses: 0 }));
        const total = lookups.hits + lookups.misses;
        return {
          verdict: redisVerdict(stats),
          facts: [
            fact('Latency', Math.round(stats.latencyMs), 'ms'),
            fact('Memory', stats.usedMemoryBytes, 'bytes'),
            fact('Cache hit rate, 1 h', total > 0 ? lookups.hits / total : null, 'percent'),
          ],
        };
      }),
      check('storage', async () => {
        await probes.storage();
        return { verdict: { status: 'ok', summary: 'Reachable.' }, facts: [] };
      }),
      check('worker', async () => {
        const [heartbeatAt, queues] = await Promise.all([probes.workerHeartbeat(), probes.queues()]);
        const waiting = queues.reduce((sum, q) => sum + q.waiting, 0);
        const failed = queues.reduce((sum, q) => sum + q.failed, 0);
        const oldestWaitingAt = queues
          .map((q) => q.oldestWaitingAt)
          .filter((d): d is Date => d !== null)
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
        return {
          verdict: workerVerdict({ heartbeatAt, failed, oldestWaitingAt }, at),
          facts: [
            fact('Last heartbeat', heartbeatAt?.toISOString() ?? null, 'datetime'),
            fact('Jobs waiting', waiting, 'count'),
            fact('Failed jobs', failed, 'count'),
            fact('Oldest waiting since', oldestWaitingAt?.toISOString() ?? null, 'datetime'),
          ],
        };
      }),
      check('clamav', async () => {
        const version = await probes.clamav();
        return {
          verdict: clamavVerdict(version.signaturesAt, at),
          facts: [
            fact('Engine', version.engine, 'text'),
            fact('Signatures from', version.signaturesAt?.toISOString() ?? null, 'datetime'),
          ],
        };
      }),
      check('email', async () => {
        await probes.smtp();
        return { verdict: { status: 'ok', summary: 'The mail relay accepts connections.' }, facts: [] };
      }),
      check('disk', async () => {
        const disk = await probes.disk();
        return {
          verdict: diskVerdict(disk.usedRatio),
          facts: [
            fact('Used', disk.usedRatio, 'percent'),
            fact('Free', disk.freeBytes, 'bytes'),
            fact('Size', disk.totalBytes, 'bytes'),
          ],
        };
      }),
    ]);

    const storageByOrganization = await metrics.storageByOrganization().catch((err: unknown) => {
      logger.warn({ err }, 'Storage per organization unavailable');
      return [];
    });
    const storage = checks.find((c) => c.id === 'storage');
    if (storage?.status === 'ok') {
      storage.facts.push(
        fact('Stored originals', storageByOrganization.reduce((sum, o) => sum + o.bytes, 0), 'bytes'),
        fact('Files', storageByOrganization.reduce((sum, o) => sum + o.files, 0), 'count'),
      );
    }

    return {
      status: worstStatus(checks.map((c) => c.status)),
      checks,
      storageByOrganization,
      generatedAt: at.toISOString(),
    };
  }

  return {
    /** GET /system/health: every check, run live (shared for a few seconds). */
    check(): Promise<SystemHealth> {
      const at = Date.now();
      if (cached && at - cached.at < cacheMs) return cached.result;
      const result = run();
      cached = { at, result };
      // A failed round is not kept: the next refresh tries again.
      result.catch(() => {
        cached = null;
      });
      return result;
    },
  };
}

export type SystemHealthService = ReturnType<typeof createSystemHealthService>;
