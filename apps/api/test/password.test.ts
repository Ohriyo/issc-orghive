import { describe, expect, it } from 'vitest';
import { createArgon2Hasher, createLimiter } from '#src/lib/password';

describe('createLimiter', () => {
  it('never runs more than `max` jobs at once, and runs them all', async () => {
    const run = createLimiter(2);
    let active = 0;
    let peak = 0;
    const job = async (n: number) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n;
    };
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => run(() => job(n))));
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  it('frees the slot when a job fails', async () => {
    const run = createLimiter(1);
    await expect(run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await run(() => Promise.resolve('ok'))).toBe('ok');
  });
});

describe('createArgon2Hasher', () => {
  it('hashes with Argon2id and verifies; a malformed hash fails closed', async () => {
    const hasher = createArgon2Hasher({ maxConcurrent: 1 });
    const hash = await hasher.hash('a long passphrase');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await hasher.verify(hash, 'a long passphrase')).toBe(true);
    expect(await hasher.verify(hash, 'wrong')).toBe(false);
    expect(await hasher.verify('not-a-hash', 'x')).toBe(false);
    await expect(hasher.verifyDummy('anything')).resolves.toBeUndefined();
  });
});
