import type { AlertKind, HealthStatus } from '@orghive/shared';

/*
 * When a service reads green, amber or red on /system/health, and when a console alert
 * opens and is emailed. Pure functions: the health and alert services gather the numbers,
 * these decide. Never re-implement them elsewhere.
 */

export const THRESHOLDS = {
  /** API: event-loop delay (p99 over the last minute) that slows every request. */
  eventLoopLagWarnMs: 200,
  postgresLatencyWarnMs: 250,
  /** Share of max_connections in use. */
  postgresConnectionsWarn: 0.8,
  redisLatencyWarnMs: 100,
  /** Share of maxmemory in use (only when Redis has a limit). */
  redisMemoryWarn: 0.8,
  /** No heartbeat for this long: the worker is down. */
  workerDownAfterMs: 2 * 60 * 1000,
  /** A job waiting this long means the worker is falling behind. */
  oldestWaitingWarnMs: 10 * 60 * 1000,
  diskWarn: 0.75,
  /** Alert and red. */
  diskFull: 0.85,
  /** ClamAV's signatures older than this: alert, and amber. */
  clamavStaleMs: 3 * 24 * 60 * 60 * 1000,
  /** Share of requests answered 5xx over the alert window. */
  errorRate: 0.05,
  p95Ms: 2_000,
  /** The window error rate and latency alerts look at. */
  alertWindowMinutes: 5,
  /** Fewer requests than this in the window prove nothing: a single 500 is not 5%. */
  alertMinRequests: 20,
} as const;

const RANK: Record<HealthStatus, number> = { ok: 0, warn: 1, down: 2 };

/** The worst of several statuses; ok for none. */
export function worstStatus(statuses: readonly HealthStatus[]): HealthStatus {
  return statuses.reduce<HealthStatus>((worst, s) => (RANK[s] > RANK[worst] ? s : worst), 'ok');
}

export interface Verdict {
  status: HealthStatus;
  summary: string;
}

const ok = (summary: string): Verdict => ({ status: 'ok', summary });
const warn = (summary: string): Verdict => ({ status: 'warn', summary });
const down = (summary: string): Verdict => ({ status: 'down', summary });

export function apiVerdict({ eventLoopLagMs }: { eventLoopLagMs: number }): Verdict {
  return eventLoopLagMs > THRESHOLDS.eventLoopLagWarnMs
    ? warn('The API is busy: its event loop is falling behind, so every request waits.')
    : ok('Answering requests.');
}

export function postgresVerdict(stats: {
  latencyMs: number;
  connections: number;
  maxConnections: number;
}): Verdict {
  if (stats.maxConnections > 0 && stats.connections / stats.maxConnections > THRESHOLDS.postgresConnectionsWarn) {
    return warn('Most database connections are in use. New requests may wait for one.');
  }
  if (stats.latencyMs > THRESHOLDS.postgresLatencyWarnMs) {
    return warn('The database is answering slowly.');
  }
  return ok('Answering queries.');
}

export function redisVerdict(stats: {
  latencyMs: number;
  usedMemoryBytes: number;
  maxMemoryBytes: number;
}): Verdict {
  if (
    stats.maxMemoryBytes > 0 &&
    stats.usedMemoryBytes / stats.maxMemoryBytes > THRESHOLDS.redisMemoryWarn
  ) {
    return warn('Redis is close to its memory limit. Cached pages and queued jobs may be dropped.');
  }
  if (stats.latencyMs > THRESHOLDS.redisLatencyWarnMs) return warn('Redis is answering slowly.');
  return ok('Answering.');
}

export interface WorkerState {
  heartbeatAt: Date | null;
  failed: number;
  /** When the longest-waiting job was queued; null when nothing waits. */
  oldestWaitingAt: Date | null;
}

export function workerIsDown(heartbeatAt: Date | null, now: Date): boolean {
  return heartbeatAt === null || now.getTime() - heartbeatAt.getTime() > THRESHOLDS.workerDownAfterMs;
}

export function workerVerdict(state: WorkerState, now: Date): Verdict {
  if (workerIsDown(state.heartbeatAt, now)) {
    return down(
      'The worker is not running: uploads stay in scanning, and no email or preview is made.',
    );
  }
  if (
    state.oldestWaitingAt &&
    now.getTime() - state.oldestWaitingAt.getTime() > THRESHOLDS.oldestWaitingWarnMs
  ) {
    return warn('Jobs have been waiting over 10 minutes. The worker is falling behind.');
  }
  if (state.failed > 0) return warn('Some jobs failed. They stay in their queue for a look.');
  return ok('Running and keeping up.');
}

export function clamavIsStale(signaturesAt: Date | null, now: Date): boolean {
  return signaturesAt !== null && now.getTime() - signaturesAt.getTime() > THRESHOLDS.clamavStaleMs;
}

export function clamavVerdict(signaturesAt: Date | null, now: Date): Verdict {
  if (signaturesAt === null) return warn('Running, but it did not say how old its signatures are.');
  if (clamavIsStale(signaturesAt, now)) {
    return warn('Running, but its virus signatures are over 3 days old. Check freshclam.');
  }
  return ok('Running with current signatures.');
}

export function diskVerdict(usedRatio: number): Verdict {
  if (usedRatio > THRESHOLDS.diskFull) return down('The disk is almost full. Free space now.');
  if (usedRatio > THRESHOLDS.diskWarn) return warn('The disk is filling up.');
  return ok('Plenty of space.');
}

/** Requests over the alert window, summed across API instances. */
export interface TrafficWindow {
  requests: number;
  serverErrors: number;
  /** Request-weighted p95; null without requests. */
  p95Ms: number | null;
}

export interface AlertInputs {
  now: Date;
  traffic: TrafficWindow;
  workerHeartbeatAt: Date | null;
  /** Null when the disk could not be read. */
  diskUsedRatio: number | null;
  /** Null when ClamAV did not answer or gave no date (health shows that instead). */
  clamavSignaturesAt: Date | null;
}

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

/**
 * The alerts that should be open now, each with its message. A kind left out should be
 * resolved. Backups have no alert yet: there are no backups to watch.
 */
export function planAlerts(input: AlertInputs): Partial<Record<AlertKind, string>> {
  const plan: Partial<Record<AlertKind, string>> = {};
  const { traffic } = input;
  const enoughTraffic = traffic.requests >= THRESHOLDS.alertMinRequests;

  if (enoughTraffic && traffic.serverErrors / traffic.requests > THRESHOLDS.errorRate) {
    plan.error_rate = `${percent(traffic.serverErrors / traffic.requests)} of requests failed with a server error in the last ${THRESHOLDS.alertWindowMinutes} minutes.`;
  }
  if (enoughTraffic && traffic.p95Ms !== null && traffic.p95Ms > THRESHOLDS.p95Ms) {
    plan.slow_responses = `Responses are slow: 95% took up to ${(traffic.p95Ms / 1000).toFixed(1)} s in the last ${THRESHOLDS.alertWindowMinutes} minutes.`;
  }
  if (workerIsDown(input.workerHeartbeatAt, input.now)) {
    plan.worker_down =
      'The worker is not running. Uploads stay in scanning and no emails go out until it is back.';
  }
  if (input.diskUsedRatio !== null && input.diskUsedRatio > THRESHOLDS.diskFull) {
    plan.disk_full = `The disk is ${percent(input.diskUsedRatio)} full.`;
  }
  if (clamavIsStale(input.clamavSignaturesAt, input.now)) {
    plan.clamav_outdated = 'ClamAV’s virus signatures are over 3 days old. New viruses may pass the scan.';
  }
  return plan;
}

/**
 * Whether a newly opened alert is emailed: not when the same kind was emailed within the
 * cooldown (an alert that flaps open and shut mails once).
 */
export function shouldNotify(
  lastNotifiedAt: Date | null,
  now: Date,
  cooldownMinutes: number,
): boolean {
  return lastNotifiedAt === null || now.getTime() - lastNotifiedAt.getTime() >= cooldownMinutes * 60_000;
}
