import type { Redis } from 'ioredis';
import { createRedis } from '#src/lib/cache';

let redis: Redis | undefined;

/** Client for the test Redis database. Tests flush it, so it must not be db 0. */
export function testRedis(): Redis {
  const url = process.env.REDIS_URL_TEST;
  if (!url) throw new Error('REDIS_URL_TEST is not set. Copy it from apps/api/.env.example.');
  const dbIndex = new URL(url).pathname.slice(1);
  if (!dbIndex || dbIndex === '0') {
    throw new Error(
      'REDIS_URL_TEST must select a non-zero database, e.g. redis://localhost:6379/15',
    );
  }
  redis ??= createRedis(url);
  return redis;
}
