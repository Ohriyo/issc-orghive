import type { Redis } from 'ioredis';
import type { LeaderboardType, Semester } from '@orghive/shared';
import type { Logger } from '#src/logger';

export interface BoardKey {
  academicYear: string;
  semester: Semester;
  type: LeaderboardType;
}

/**
 * The current standings of each board, ordered. Services depend on this port, not on Redis,
 * so unit tests can use `memoryLeaderboardStore`.
 */
export interface LeaderboardStore {
  /** Replaces a board's rows; the order given is the rank order. */
  write<T extends { organizationId: string }>(key: BoardKey, rows: T[]): Promise<void>;
  /** The board's rows in rank order, or null when it was never written (or expired). */
  read<T>(key: BoardKey): Promise<T[] | null>;
}

/** A board stays in Redis this long without a recompute; the database can rebuild it. */
export const BOARD_TTL_SECONDS = 7 * 24 * 60 * 60;

const base = ({ academicYear, semester, type }: BoardKey) =>
  `leaderboard:${academicYear}:${semester}:${type}`;

export const leaderboardKeys = {
  /** Sorted set: member organizationId, score its position (0 = first). */
  order: (key: BoardKey) => `${base(key)}:order`,
  /** Hash: organizationId → the row as JSON. */
  rows: (key: BoardKey) => `${base(key)}:rows`,
  /** When the board was written; its presence tells "empty" from "never written". */
  written: (key: BoardKey) => `${base(key)}:written`,
};

/**
 * Redis: a sorted set per board scored by position, plus a hash of the rows. The ranking
 * rules order the rows (points, profit, completion date); one numeric score could not hold
 * all three exactly once the late value is configurable, so the score is the position.
 * A write replaces the board in one MULTI, so readers never see half of it. A Redis failure
 * never fails the request: it is logged, a read returns null and the board is recomputed
 * from the database.
 */
export function createRedisLeaderboardStore(redis: Redis, logger: Logger): LeaderboardStore {
  return {
    async write(key, rows) {
      try {
        await writeBoard(key, rows);
      } catch (err) {
        logger.warn({ err, board: base(key) }, 'Leaderboard write to Redis failed');
      }
    },

    async read<T>(key: BoardKey) {
      try {
        return await readBoard<T>(key);
      } catch (err) {
        logger.warn({ err, board: base(key) }, 'Leaderboard read from Redis failed');
        return null;
      }
    },
  };

  async function writeBoard<T extends { organizationId: string }>(key: BoardKey, rows: T[]) {
    const order = leaderboardKeys.order(key);
    const hash = leaderboardKeys.rows(key);
    const written = leaderboardKeys.written(key);
    const tx = redis.multi().del(order, hash);
    if (rows.length > 0) {
      tx.zadd(order, ...rows.flatMap((row, i) => [String(i), row.organizationId]));
      tx.hset(
        hash,
        Object.fromEntries(rows.map((row) => [row.organizationId, JSON.stringify(row)])),
      );
      tx.expire(order, BOARD_TTL_SECONDS).expire(hash, BOARD_TTL_SECONDS);
    }
    tx.set(written, new Date().toISOString(), 'EX', BOARD_TTL_SECONDS);
    await tx.exec();
  }

  async function readBoard<T>(key: BoardKey): Promise<T[] | null> {
    const [written, ids] = await Promise.all([
      redis.get(leaderboardKeys.written(key)),
      redis.zrange(leaderboardKeys.order(key), '0', '-1'),
    ]);
    if (written === null) return null;
    if (ids.length === 0) return [];
    const rows = await redis.hmget(leaderboardKeys.rows(key), ...ids);
    // A row missing from the hash means the board expired mid-read: rebuild it.
    if (rows.some((row) => row === null)) return null;
    return rows.map((row) => JSON.parse(row!) as T);
  }
}

/** In memory, for unit tests. */
export function memoryLeaderboardStore(): LeaderboardStore & { boards: Map<string, unknown[]> } {
  const boards = new Map<string, unknown[]>();
  return {
    boards,
    write(key, rows) {
      boards.set(base(key), structuredClone(rows));
      return Promise.resolve();
    },
    read<T>(key: BoardKey) {
      const rows = boards.get(base(key));
      return Promise.resolve(rows ? (structuredClone(rows) as T[]) : null);
    },
  };
}
