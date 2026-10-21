import { pino } from 'pino';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { SemesterKey } from '@orghive/shared';
import { createRedis } from '#src/lib/cache';
import {
  createRedisLeaderboardEvents,
  LEADERBOARD_CHANNEL,
  memoryLeaderboardEvents,
  subscribeLeaderboardChanges,
} from '#src/lib/leaderboard-events';
import { testRedis } from './redis';

const redis = testRedis();
const subscriber = createRedis(process.env.REDIS_URL_TEST!);
const logger = pino({ level: 'silent' });
const FIRST = { academicYear: '2026-2027', semester: 'first' as const };

afterAll(async () => {
  await subscriber.quit();
  await redis.quit();
});

/** Resolves with the next semester the subscriber hears. */
function nextChange(received: SemesterKey[]): Promise<void> {
  const before = received.length;
  return vi.waitFor(() => {
    if (received.length === before) throw new Error('nothing yet');
  });
}

describe('leaderboard events over Redis pub/sub', () => {
  it('delivers a published semester, ignores junk, and stops after unsubscribing', async () => {
    const received: SemesterKey[] = [];
    const warn = vi.spyOn(logger, 'warn');
    const unsubscribe = await subscribeLeaderboardChanges(subscriber, logger, (s) =>
      received.push(s),
    );

    const heard = nextChange(received);
    await createRedisLeaderboardEvents(redis, logger).publish(FIRST);
    await heard;
    expect(received).toEqual([FIRST]);

    await redis.publish(LEADERBOARD_CHANNEL, 'not json');
    await redis.publish(LEADERBOARD_CHANNEL, JSON.stringify({ academicYear: 'x' }));
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
    expect(received).toHaveLength(1);

    await unsubscribe();
    await redis.publish(LEADERBOARD_CHANNEL, JSON.stringify(FIRST));
    // A round trip on the subscriber's own connection: anything published before it
    // would have arrived by now.
    await subscriber.ping();
    expect(received).toHaveLength(1);
  });

  it('logs a failed publish instead of failing the recompute', async () => {
    const broken = { publish: vi.fn(() => Promise.reject(new Error('down'))) };
    const warn = vi.fn();
    const events = createRedisLeaderboardEvents(broken as never, { warn } as never);
    await expect(events.publish(FIRST)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('records publications in memory for unit tests', async () => {
    const events = memoryLeaderboardEvents();
    await events.publish(FIRST);
    expect(events.published).toEqual([FIRST]);
  });
});
