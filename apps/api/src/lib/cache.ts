import { Redis } from 'ioredis';
import type { Logger } from '#src/logger';

/** Cache-aside port. Services depend on this, not on Redis, so unit tests can use `memoryCache`. */
export interface Cache {
  /** Returns the cached value for `key`, or runs `load`, caches a non-null result and returns it. */
  getOrSet<T>(key: string, ttlSeconds: number, load: () => Promise<T | null>): Promise<T | null>;
  /** Deletes every key matching a glob such as `org:jpice:docs:*`. */
  deleteMatching(pattern: string): Promise<void>;
}

export const cacheKeys = {
  collegeList: () => 'college:list',
  college: (slug: string) => `college:${slug}`,
  organization: (slug: string) => `org:${slug}`,
  organizationDocuments: (slug: string, queryHash: string) => `org:${slug}:docs:${queryHash}`,
  /** Every cached document list of one organization. Delete it on any document write. */
  organizationDocumentsPattern: (slug: string) => `org:${slug}:docs:*`,
};

export const PUBLIC_READ_TTL_SECONDS = 10 * 60;

export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: 1 });
}

/**
 * Redis-backed cache. A Redis failure never fails the request: reads fall through
 * to `load` and the error is logged (without the value).
 */
export function createRedisCache(redis: Redis, logger: Logger): Cache {
  return {
    async getOrSet<T>(key: string, ttlSeconds: number, load: () => Promise<T | null>) {
      try {
        const hit = await redis.get(key);
        if (hit !== null) return JSON.parse(hit) as T;
      } catch (err) {
        logger.warn({ err, key }, 'Cache read failed; loading from source');
      }

      const value = await load();
      // Misses (null) are not cached, so a newly created slug shows up immediately.
      if (value !== null) {
        try {
          await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
        } catch (err) {
          logger.warn({ err, key }, 'Cache write failed');
        }
      }
      return value;
    },

    async deleteMatching(pattern: string) {
      // SCAN, not KEYS, so a large keyspace never blocks Redis. A failure is logged and the
      // entries expire on their TTL; it must not fail the write that triggered it.
      try {
        let cursor = '0';
        do {
          const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
          if (keys.length > 0) await redis.unlink(...keys);
          cursor = next;
        } while (cursor !== '0');
      } catch (err) {
        logger.warn({ err, pattern }, 'Cache invalidation failed');
      }
    },
  };
}

/** In-process cache for unit tests. Ignores TTL. */
export function memoryCache(): Cache & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async getOrSet<T>(key: string, _ttl: number, load: () => Promise<T | null>) {
      const hit = store.get(key);
      if (hit !== undefined) return JSON.parse(hit) as T;
      const value = await load();
      if (value !== null) store.set(key, JSON.stringify(value));
      return value;
    },
    deleteMatching(pattern: string) {
      const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
      for (const key of [...store.keys()]) {
        if (pattern.endsWith('*') ? key.startsWith(prefix) : key === pattern) store.delete(key);
      }
      return Promise.resolve();
    },
  };
}
