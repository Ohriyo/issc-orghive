import type { Redis } from 'ioredis';

/*
 * Rate limit hits (requests refused with 429), for the /system security center. Counted per
 * hour in Redis, per limiter and client IP, and kept 8 days so the 7-day view is whole.
 * Recording is best effort: a Redis failure never changes the 429 itself.
 */

const HOUR_MS = 60 * 60 * 1000;
const KEEP_SECONDS = 8 * 24 * 60 * 60;
const SEPARATOR = '|';

const hourKey = (hour: number) => `rlhits:${hour}`;

export interface RateLimitHits {
  total: number;
  byLimiter: { limiter: string; hits: number }[];
  byIp: { ip: string; hits: number; limiters: string[] }[];
}

export interface RateLimitHitReader {
  /** Hits from `since` (rounded down to its hour) until now. */
  read(since: Date, now: Date, top: number): Promise<RateLimitHits>;
}

/** Adds one hit; never throws. */
export function recordRateLimitHit(
  redis: Pick<Redis, 'multi'>,
  limiter: string,
  ip: string,
  at = new Date(),
): void {
  const key = hourKey(Math.floor(at.getTime() / HOUR_MS));
  redis
    .multi()
    .hincrby(key, `${limiter}${SEPARATOR}${ip}`, 1)
    .expire(key, KEEP_SECONDS)
    .exec()
    .catch(() => undefined);
}

/** Sums hourly counts into totals per limiter and the busiest IPs. Pure, for tests. */
export function summarizeRateLimitHits(
  hours: readonly Record<string, string>[],
  top: number,
): RateLimitHits {
  const byLimiter = new Map<string, number>();
  const byIp = new Map<string, { hits: number; limiters: Set<string> }>();
  let total = 0;
  for (const fields of hours) {
    for (const [field, value] of Object.entries(fields)) {
      const hits = Number(value);
      if (!Number.isFinite(hits) || hits <= 0) continue;
      const at = field.indexOf(SEPARATOR);
      const limiter = at < 0 ? field : field.slice(0, at);
      const ip = at < 0 ? 'unknown' : field.slice(at + 1);
      total += hits;
      byLimiter.set(limiter, (byLimiter.get(limiter) ?? 0) + hits);
      const entry = byIp.get(ip) ?? { hits: 0, limiters: new Set<string>() };
      entry.hits += hits;
      entry.limiters.add(limiter);
      byIp.set(ip, entry);
    }
  }
  return {
    total,
    byLimiter: [...byLimiter]
      .map(([limiter, hits]) => ({ limiter, hits }))
      .sort((a, b) => b.hits - a.hits || a.limiter.localeCompare(b.limiter)),
    byIp: [...byIp]
      .map(([ip, { hits, limiters }]) => ({ ip, hits, limiters: [...limiters].sort() }))
      .sort((a, b) => b.hits - a.hits || a.ip.localeCompare(b.ip))
      .slice(0, top),
  };
}

export function createRateLimitHitReader(redis: Pick<Redis, 'pipeline'>): RateLimitHitReader {
  return {
    async read(since, now, top) {
      const first = Math.floor(since.getTime() / HOUR_MS);
      const last = Math.floor(now.getTime() / HOUR_MS);
      const pipeline = redis.pipeline();
      for (let hour = first; hour <= last; hour++) pipeline.hgetall(hourKey(hour));
      const results = (await pipeline.exec()) ?? [];
      const hours = results
        .filter(([err]) => !err)
        .map(([, value]) => (value ?? {}) as Record<string, string>);
      return summarizeRateLimitHits(hours, top);
    },
  };
}
