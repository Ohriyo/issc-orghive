import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createRedisLeaderboardStore,
  leaderboardKeys,
  memoryLeaderboardStore,
} from '#src/lib/leaderboard-store';
import { testRedis } from './redis';

const redis = testRedis();
const store = createRedisLeaderboardStore(redis, pino({ level: 'silent' }));
const KEY = { academicYear: '2026-2027', semester: 'first' as const, type: 'SBO' as const };

beforeEach(async () => {
  await redis.flushdb();
});

afterAll(async () => {
  await redis.quit();
});

describe('Redis leaderboard store', () => {
  it('keeps the rank order and the rows', async () => {
    const rows = [
      { organizationId: 'b', points: 3 },
      { organizationId: 'a', points: 2 },
      { organizationId: 'c', points: 2 },
    ];
    await store.write(KEY, rows);
    expect(await store.read(KEY)).toEqual(rows);
    expect(await redis.zscore(leaderboardKeys.order(KEY), 'c')).toBe('2');
    expect(await redis.ttl(leaderboardKeys.rows(KEY))).toBeGreaterThan(0);
  });

  it('replaces a board whole', async () => {
    await store.write(KEY, [{ organizationId: 'a' }, { organizationId: 'b' }]);
    await store.write(KEY, [{ organizationId: 'c' }]);
    expect(await store.read(KEY)).toEqual([{ organizationId: 'c' }]);
  });

  it('tells an empty board from one never written, per board', async () => {
    expect(await store.read(KEY)).toBeNull();
    await store.write(KEY, []);
    expect(await store.read(KEY)).toEqual([]);
    expect(await store.read({ ...KEY, type: 'CSC' })).toBeNull();
  });

  it('rebuilds when rows went missing', async () => {
    await store.write(KEY, [{ organizationId: 'a' }]);
    await redis.del(leaderboardKeys.rows(KEY));
    expect(await store.read(KEY)).toBeNull();
  });

  it('never fails the caller when Redis is down', async () => {
    const broken = createRedisLeaderboardStore(
      {
        get: () => Promise.reject(new Error('down')),
        zrange: () => Promise.reject(new Error('down')),
        multi: () => {
          throw new Error('down');
        },
      } as never,
      pino({ level: 'silent' }),
    );
    await expect(broken.write(KEY, [{ organizationId: 'a' }])).resolves.toBeUndefined();
    expect(await broken.read(KEY)).toBeNull();
  });
});

describe('memory leaderboard store', () => {
  it('returns copies', async () => {
    const memory = memoryLeaderboardStore();
    const rows = [{ organizationId: 'a' }];
    await memory.write(KEY, rows);
    rows[0]!.organizationId = 'changed';
    expect(await memory.read(KEY)).toEqual([{ organizationId: 'a' }]);
    expect(await memory.read({ ...KEY, type: 'CSC' })).toBeNull();
  });
});
