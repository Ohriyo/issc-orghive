import type { Redis } from 'ioredis';

/**
 * Counting and deleting cache keys for /system/cache. Separate from `Cache` (the services'
 * cache-aside port) because only the super admin's tools need counts. SCAN, never KEYS, so
 * a large keyspace never blocks Redis.
 */
export interface CacheAdmin {
  /** Keys matching each glob; an exact key (no `*`) counts 0 or 1. */
  count(pattern: string): Promise<number>;
  /** Deletes every key matching the glob; returns how many went. */
  remove(pattern: string): Promise<number>;
  /** The whole Redis: every key (sessions, rate limits and queues too) and memory used. */
  stats(): Promise<{ totalKeys: number | null; usedMemoryBytes: number | null }>;
}

const SCAN_COUNT = 500;

async function scanAll(redis: Redis, pattern: string, onKeys: (keys: string[]) => Promise<void>) {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', SCAN_COUNT);
    if (keys.length > 0) await onKeys(keys);
    cursor = next;
  } while (cursor !== '0');
}

/** `used_memory:<bytes>` from INFO memory, or null. */
export function usedMemoryOf(info: string): number | null {
  const match = /^used_memory:(\d+)\r?$/m.exec(info);
  return match ? Number(match[1]) : null;
}

export function createRedisCacheAdmin(redis: Redis): CacheAdmin {
  return {
    async count(pattern) {
      if (!pattern.includes('*')) return redis.exists(pattern);
      let total = 0;
      await scanAll(redis, pattern, (keys) => {
        total += keys.length;
        return Promise.resolve();
      });
      return total;
    },

    async remove(pattern) {
      if (!pattern.includes('*')) return redis.unlink(pattern);
      let deleted = 0;
      await scanAll(redis, pattern, async (keys) => {
        deleted += await redis.unlink(...keys);
      });
      return deleted;
    },

    async stats() {
      const [size, info] = await Promise.all([
        redis.dbsize().catch(() => null),
        redis.info('memory').catch(() => null),
      ]);
      return { totalKeys: size, usedMemoryBytes: info ? usedMemoryOf(info) : null };
    },
  };
}
