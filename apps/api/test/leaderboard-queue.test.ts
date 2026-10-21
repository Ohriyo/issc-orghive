import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createBullLeaderboardQueue,
  createQueueConnection,
  LEADERBOARD_DEBOUNCE_MS,
} from '#src/lib/queue';
import { testRedis } from './redis';

const redis = testRedis();
const connection = createQueueConnection(process.env.REDIS_URL_TEST!);
const leaderboard = createBullLeaderboardQueue(connection);
const FIRST = { academicYear: '2026-2027', semester: 'first' as const };
const SECOND = { academicYear: '2026-2027', semester: 'second' as const };

beforeEach(async () => {
  await redis.flushdb();
});

afterAll(async () => {
  await leaderboard.queue.close();
  await connection.quit();
  await redis.quit();
});

describe('leaderboard queue', () => {
  it('collapses changes to one semester into one delayed recompute', async () => {
    for (let i = 0; i < 5; i += 1) await leaderboard.enqueueRecompute(FIRST);
    const delayed = await leaderboard.queue.getDelayed();
    expect(delayed).toHaveLength(1);
    expect(delayed[0]!.name).toBe('recompute');
    expect(delayed[0]!.data).toEqual(FIRST);
    expect(delayed[0]!.opts.delay).toBe(LEADERBOARD_DEBOUNCE_MS);
    expect(delayed[0]!.opts.deduplication).toMatchObject({
      id: 'leaderboard-2026-2027-first',
      keepLastIfActive: true,
    });
  });

  it('keeps one recompute per semester', async () => {
    await leaderboard.enqueueRecompute(FIRST);
    await leaderboard.enqueueRecompute(SECOND);
    await leaderboard.enqueueRecompute(FIRST);
    const delayed = await leaderboard.queue.getDelayed();
    const semesters = delayed.map((job) => (job.data as { semester: string }).semester).sort();
    expect(semesters).toEqual(['first', 'second']);
  });
});
