import type { Redis } from 'ioredis';
import { z } from 'zod';
import { academicYearSchema, semesterSchema, type SemesterKey } from '@orghive/shared';
import type { Logger } from '#src/logger';

/** Redis pub/sub channel: the worker publishes a semester whose standings changed. */
export const LEADERBOARD_CHANNEL = 'leaderboard:changed';

const messageSchema = z.object({ academicYear: academicYearSchema, semester: semesterSchema });

/** What the leaderboard service needs to say "this semester's standings changed". */
export interface LeaderboardEvents {
  publish(semester: SemesterKey): Promise<void>;
}

/**
 * Publishes on Redis, so every API instance hears it. Only the semester travels: each
 * instance reads the boards from the store. A failure is logged and never fails the
 * recompute; clients still get the change from their next poll or reconnect.
 */
export function createRedisLeaderboardEvents(redis: Redis, logger: Logger): LeaderboardEvents {
  return {
    async publish({ academicYear, semester }) {
      try {
        await redis.publish(LEADERBOARD_CHANNEL, JSON.stringify({ academicYear, semester }));
      } catch (err) {
        logger.warn({ err }, 'Leaderboard change could not be published');
      }
    },
  };
}

/**
 * Calls `onChange` for every semester published on the channel. `subscriber` must be a
 * connection of its own: a subscribed ioredis connection cannot run other commands.
 * Returns a function that unsubscribes.
 */
export async function subscribeLeaderboardChanges(
  subscriber: Redis,
  logger: Logger,
  onChange: (semester: SemesterKey) => void,
): Promise<() => Promise<void>> {
  const listener = (channel: string, message: string) => {
    if (channel !== LEADERBOARD_CHANNEL) return;
    let parsed;
    try {
      parsed = messageSchema.safeParse(JSON.parse(message));
    } catch {
      parsed = null;
    }
    if (!parsed?.success) {
      logger.warn({ channel }, 'Ignored an unreadable leaderboard message');
      return;
    }
    onChange(parsed.data);
  };
  subscriber.on('message', listener);
  await subscriber.subscribe(LEADERBOARD_CHANNEL);
  return async () => {
    subscriber.off('message', listener);
    await subscriber.unsubscribe(LEADERBOARD_CHANNEL);
  };
}

/** In memory, for unit tests: records what was published. */
export function memoryLeaderboardEvents(): LeaderboardEvents & { published: SemesterKey[] } {
  const published: SemesterKey[] = [];
  return {
    published,
    publish(semester) {
      published.push({ ...semester });
      return Promise.resolve();
    },
  };
}
