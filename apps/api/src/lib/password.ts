import { availableParallelism } from 'node:os';
import argon2, { type HashOptions } from 'argon2';

/** Password hashing port, so services stay testable and the algorithm lives in one place. */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
  /**
   * Burns the same time as a real verify. Called for unknown emails, so response timing
   * does not reveal which accounts exist.
   */
  verifyDummy(password: string): Promise<void>;
}

/**
 * Runs at most `max` jobs at once; the rest wait their turn. Each Argon2 call holds 64 MiB,
 * so an unbounded login flood (spread over many IPs, each under its rate limit) could
 * otherwise exhaust memory. Queued logins just answer a little later.
 */
export function createLimiter(max: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(job: () => Promise<T>): Promise<T> {
    if (running >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    running++;
    try {
      return await job();
    } finally {
      running--;
      waiting.shift()?.();
    }
  };
}

export interface Argon2HasherOptions {
  maxConcurrent?: number;
  /**
   * Cost of new hashes. Defaults to the library's (64 MiB, 3 passes, parallelism 4), above
   * OWASP's minimum. Only tests lower it; verify always uses the cost stored in the hash.
   */
  cost?: { memoryCost: number; timeCost: number; parallelism: number };
}

export function createArgon2Hasher({
  maxConcurrent = Math.max(2, availableParallelism()),
  cost,
}: Argon2HasherOptions = {}): PasswordHasher {
  const limit = createLimiter(maxConcurrent);
  const options: HashOptions = { type: argon2.argon2id, ...cost };
  let dummy: Promise<string> | undefined;
  return {
    hash: (password) => limit(() => argon2.hash(password, options)),
    verify: (hash, password) =>
      limit(async () => {
        try {
          return await argon2.verify(hash, password);
        } catch {
          // A malformed stored hash fails closed, never a 500 that hints at the account.
          return false;
        }
      }),
    async verifyDummy(password) {
      // Same cost as real hashes, so an unknown email takes as long as a wrong password.
      dummy ??= argon2.hash('orghive-timing-equalizer', options);
      const hash = await dummy;
      await limit(() => argon2.verify(hash, password).catch(() => false));
    },
  };
}
