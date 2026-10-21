import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { superAdminPasswordProblem } from '#src/lib/password-policy';
import { generateRecoveryCodes, normalizeRecoveryCode } from '#src/lib/recovery-codes';
import { createSecretBox, generateSecretBoxKey } from '#src/lib/secret-box';
import { createRedisSuperAdminStore } from '#src/lib/super-admin-store';
import { createTotp } from '#src/lib/totp';
import { testRedis } from './redis';

describe('secret box', () => {
  const box = createSecretBox(generateSecretBoxKey());

  it('round-trips, with a fresh IV each time', () => {
    const a = box.seal('JBSWY3DPEHPK3PXP', 'user-1');
    expect(a).not.toBe(box.seal('JBSWY3DPEHPK3PXP', 'user-1'));
    expect(box.open(a, 'user-1')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('refuses another context, another key, tampering and junk', () => {
    const sealed = box.seal('secret', 'user-1');
    expect(() => box.open(sealed, 'user-2')).toThrow();
    expect(() => createSecretBox(generateSecretBoxKey()).open(sealed, 'user-1')).toThrow();
    const [v, iv, tag, ct] = sealed.split('.');
    // Always a different first character: replacing it with 'A' alone did nothing 1 time in 64.
    const tampered = `${ct!.startsWith('A') ? 'B' : 'A'}${ct!.slice(1)}`;
    expect(() => box.open([v, iv, tag, tampered].join('.'), 'user-1')).toThrow();
    expect(() => box.open('v2.a.b.c', 'user-1')).toThrow(/Unrecognized/);
    expect(() => createSecretBox('c2hvcnQ=')).toThrow(/32 random bytes/);
  });
});

describe('super admin password policy', () => {
  const account = { email: 'juan.delacruz@nwssu.edu.ph', name: 'Juan Dela Cruz' };

  it('accepts a long, uncommon passphrase', () => {
    expect(superAdminPasswordProblem('violet orbit lantern 42', account)).toBeNull();
  });

  it('refuses short, breached, personal and repetitive passwords', () => {
    expect(superAdminPasswordProblem('thirteen char', account)).toMatch(/at least 14/);
    expect(superAdminPasswordProblem('x'.repeat(129), account)).toMatch(/at most/);
    expect(superAdminPasswordProblem('PasswordPassword', account)).toMatch(/breached/);
    expect(superAdminPasswordProblem('qwertyuiopasdfghjkl', account)).toMatch(/breached/);
    expect(superAdminPasswordProblem('my name is delacruz ok', account)).toMatch(/name or email/);
    expect(superAdminPasswordProblem('juan.delacruz!2026', account)).toMatch(/name or email/);
    expect(superAdminPasswordProblem('abababababababab', account)).toMatch(/different characters/);
  });
});

describe('recovery codes', () => {
  it('are 10 distinct, unambiguous codes that normalize back', () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/);
      expect(normalizeRecoveryCode(` ${code.toUpperCase().replace('-', ' ')} `)).toBe(
        code.replace('-', ''),
      );
    }
    expect(normalizeRecoveryCode('short')).toBeNull();
  });
});

describe('totp', () => {
  const totp = createTotp();
  const secret = totp.generateSecret();
  const at = new Date('2026-10-19T08:00:10Z');

  it('accepts the current code and one step either side, then never an older step', async () => {
    const step = await totp.verify(secret, await totp.generate(secret, at), { at });
    expect(step).toBe(Math.floor(at.getTime() / 30_000));
    const early = await totp.generate(secret, new Date(at.getTime() - 30_000));
    expect(await totp.verify(secret, early, { at })).toBe(step! - 1);
    expect(await totp.verify(secret, early, { at, afterTimeStep: step })).toBeNull();
    const stale = await totp.generate(secret, new Date(at.getTime() - 90_000));
    expect(await totp.verify(secret, stale, { at })).toBeNull();
    expect(totp.uri('dev@nwssu.test', secret)).toContain('issuer=Orghive');
  });
});

describe('redis super admin store', () => {
  const redis = testRedis();
  const store = createRedisSuperAdminStore(redis);
  const at = new Date('2026-10-19T08:00:00Z');

  beforeEach(async () => {
    await redis.flushdb();
  });
  afterAll(async () => {
    await redis.quit();
  });

  it('keeps session times, and never revives an ended session', async () => {
    await store.startSession('s1', at, 60);
    await store.touchSession('s1', new Date(at.getTime() + 1000));
    await store.setStepUp('s1', new Date(at.getTime() + 2000));
    expect(await store.getSession('s1')).toEqual({
      startedAt: at,
      lastSeenAt: new Date(at.getTime() + 1000),
      stepUpAt: new Date(at.getTime() + 2000),
    });
    await store.endSession('s1');
    await store.touchSession('s1', at);
    await store.setStepUp('s1', at);
    expect(await store.getSession('s1')).toBeNull();
  });

  it('completes a challenge once', async () => {
    await store.createChallenge('h', 'user-1', 60);
    expect(await store.getChallenge('h')).toBe('user-1');
    expect(await store.consumeChallenge('h')).toBe(true);
    expect(await store.consumeChallenge('h')).toBe(false);
    expect(await store.getChallenge('h')).toBeNull();
  });

  it('counts failures per key with one window, and claims an alert once', async () => {
    expect(await store.addFailure(['acct:1', 'ip:x'], 60)).toEqual([1, 1]);
    expect(await store.addFailure(['acct:1'], 60)).toEqual([2]);
    expect(await store.failureCounts(['acct:1', 'ip:x', 'acct:2'])).toEqual([2, 1, 0]);
    expect(await store.failureCounts([])).toEqual([]);
    expect(await redis.ttl('sa:fail:acct:1')).toBeGreaterThan(0);
    expect(await store.claimAlert('acct:1', 60)).toBe(true);
    expect(await store.claimAlert('acct:1', 60)).toBe(false);
  });
});
