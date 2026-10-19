import type { Redis } from 'ioredis';

/**
 * Short-lived super admin state, in Redis so every API instance sees it: session activity
 * (idle timeout, step-up), sign-in challenges between the password and the code, and
 * failure counters for the lockout. Times come from the caller, so services decide with
 * their own clock and tests can move it.
 */
export interface SuperAdminSessionState {
  startedAt: Date;
  lastSeenAt: Date;
  /** The last successful step-up code, or null. */
  stepUpAt: Date | null;
}

export interface SuperAdminStore {
  /** `ttlSeconds` only cleans up; the service checks the times itself. */
  startSession(sessionId: string, at: Date, ttlSeconds: number): Promise<void>;
  getSession(sessionId: string): Promise<SuperAdminSessionState | null>;
  touchSession(sessionId: string, at: Date): Promise<void>;
  setStepUp(sessionId: string, at: Date): Promise<void>;
  endSession(sessionId: string): Promise<void>;

  /** Keyed by the challenge token's hash; the value is the user id. */
  createChallenge(tokenHash: string, userId: string, ttlSeconds: number): Promise<void>;
  getChallenge(tokenHash: string): Promise<string | null>;
  /** True for exactly one caller, so a challenge completes once. */
  consumeChallenge(tokenHash: string): Promise<boolean>;

  /** Adds one failure to each counter; the window starts at a counter's first failure. */
  addFailure(keys: string[], windowSeconds: number): Promise<number[]>;
  failureCounts(keys: string[]): Promise<number[]>;
  /** True the first time per window: one lockout alert, not one per attempt. */
  claimAlert(key: string, ttlSeconds: number): Promise<boolean>;
}

const sessionKey = (id: string) => `sa:session:${id}`;
const challengeKey = (hash: string) => `sa:challenge:${hash}`;
const failureKey = (key: string) => `sa:fail:${key}`;
const alertKey = (key: string) => `sa:alert:${key}`;

function dateOf(value: string | undefined): Date | null {
  return value ? new Date(Number(value)) : null;
}

export function createRedisSuperAdminStore(redis: Redis): SuperAdminStore {
  return {
    async startSession(sessionId, at, ttlSeconds) {
      const key = sessionKey(sessionId);
      await redis
        .multi()
        .del(key)
        .hset(key, { startedAt: at.getTime(), lastSeenAt: at.getTime() })
        .expire(key, ttlSeconds)
        .exec();
    },

    async getSession(sessionId) {
      const fields = await redis.hgetall(sessionKey(sessionId));
      const startedAt = dateOf(fields.startedAt);
      const lastSeenAt = dateOf(fields.lastSeenAt);
      if (!startedAt || !lastSeenAt) return null;
      return { startedAt, lastSeenAt, stepUpAt: dateOf(fields.stepUpAt) };
    },

    async touchSession(sessionId, at) {
      // HSET only on an existing hash: an ended session must not come back.
      const key = sessionKey(sessionId);
      if (await redis.exists(key)) await redis.hset(key, 'lastSeenAt', at.getTime());
    },

    async setStepUp(sessionId, at) {
      const key = sessionKey(sessionId);
      if (await redis.exists(key)) await redis.hset(key, 'stepUpAt', at.getTime());
    },

    async endSession(sessionId) {
      await redis.del(sessionKey(sessionId));
    },

    async createChallenge(tokenHash, userId, ttlSeconds) {
      await redis.set(challengeKey(tokenHash), userId, 'EX', ttlSeconds);
    },

    getChallenge(tokenHash) {
      return redis.get(challengeKey(tokenHash));
    },

    async consumeChallenge(tokenHash) {
      return (await redis.del(challengeKey(tokenHash))) === 1;
    },

    async addFailure(keys, windowSeconds) {
      const multi = redis.multi();
      for (const key of keys) {
        multi.incr(failureKey(key)).expire(failureKey(key), windowSeconds, 'NX');
      }
      const results = (await multi.exec()) ?? [];
      // Each key added two replies: INCR's count, then EXPIRE's.
      return keys.map((_, i) => Number(results[i * 2]?.[1] ?? 0));
    },

    async failureCounts(keys) {
      if (keys.length === 0) return [];
      const values = await redis.mget(keys.map(failureKey));
      return values.map((value) => Number(value ?? 0));
    },

    async claimAlert(key, ttlSeconds) {
      return (await redis.set(alertKey(key), '1', 'EX', ttlSeconds, 'NX')) === 'OK';
    },
  };
}

/** The same contract in memory, for unit tests. Expiry follows the given clock. */
export function memorySuperAdminStore(now: () => Date = () => new Date()): SuperAdminStore {
  const sessions = new Map<string, SuperAdminSessionState>();
  const challenges = new Map<string, { userId: string; expiresAt: number }>();
  const failures = new Map<string, { count: number; expiresAt: number }>();
  const alerts = new Map<string, number>();
  const live = <T extends { expiresAt: number }>(entry: T | undefined) =>
    entry && entry.expiresAt > now().getTime() ? entry : undefined;
  const done = () => Promise.resolve();

  return {
    startSession(sessionId, at) {
      sessions.set(sessionId, { startedAt: at, lastSeenAt: at, stepUpAt: null });
      return done();
    },
    getSession(sessionId) {
      const state = sessions.get(sessionId);
      return Promise.resolve(state ? { ...state } : null);
    },
    touchSession(sessionId, at) {
      const state = sessions.get(sessionId);
      if (state) state.lastSeenAt = at;
      return done();
    },
    setStepUp(sessionId, at) {
      const state = sessions.get(sessionId);
      if (state) state.stepUpAt = at;
      return done();
    },
    endSession(sessionId) {
      sessions.delete(sessionId);
      return done();
    },
    createChallenge(tokenHash, userId, ttlSeconds) {
      challenges.set(tokenHash, { userId, expiresAt: now().getTime() + ttlSeconds * 1000 });
      return done();
    },
    getChallenge(tokenHash) {
      return Promise.resolve(live(challenges.get(tokenHash))?.userId ?? null);
    },
    consumeChallenge(tokenHash) {
      const found = live(challenges.get(tokenHash));
      challenges.delete(tokenHash);
      return Promise.resolve(Boolean(found));
    },
    addFailure(keys, windowSeconds) {
      return Promise.resolve(
        keys.map((key) => {
          const entry = live(failures.get(key)) ?? {
            count: 0,
            expiresAt: now().getTime() + windowSeconds * 1000,
          };
          entry.count++;
          failures.set(key, entry);
          return entry.count;
        }),
      );
    },
    failureCounts(keys) {
      return Promise.resolve(keys.map((key) => live(failures.get(key))?.count ?? 0));
    },
    claimAlert(key, ttlSeconds) {
      const until = alerts.get(key);
      if (until !== undefined && until > now().getTime()) return Promise.resolve(false);
      alerts.set(key, now().getTime() + ttlSeconds * 1000);
      return Promise.resolve(true);
    },
  };
}
