import { describe, expect, it, vi } from 'vitest';
import { generateTemporaryPassword } from '#src/lib/temporary-password';
import { createRevealService } from '#src/services/reveal.service';
import { passwordRecipientOf } from '#src/services/account-rules';
import { createSessionGuard } from '#src/services/session-guard';

describe('generateTemporaryPassword', () => {
  it('is 16 unambiguous characters in groups of 4, different every time', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const password = generateTemporaryPassword();
      expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{4}(-[A-HJ-NP-Za-km-z2-9]{4}){3}$/);
      seen.add(password);
    }
    expect(seen.size).toBe(200);
  });
});

describe('passwordRecipientOf', () => {
  it('sends every organization’s password to the ISSC’s Reveal, and the ISSC’s own to the screen once', () => {
    expect(passwordRecipientOf({ type: 'SBO' })).toBe('issc_reveal');
    expect(passwordRecipientOf({ type: 'CSC' })).toBe('issc_reveal');
    expect(passwordRecipientOf({ type: 'ISSC' })).toBe('shown_once');
  });
});

describe('the session guard', () => {
  const revokedAt = new Date('2026-10-20T08:00:00.500Z');
  function guard(revoked: Date | null) {
    const checkSession = vi.fn(() => Promise.resolve());
    return {
      check: createSessionGuard({
        accounts: { sessionsRevokedAt: () => Promise.resolve(revoked) },
        superAdmins: { checkSession },
      }),
      checkSession,
    };
  }
  const claims = (issuedAtMs: number, sessionId?: string) => ({
    userId: 'u1',
    jti: 'j',
    passwordChangeRequired: false,
    issuedAtMs,
    ...(sessionId && { sessionId }),
  });

  it('refuses a token from before the revocation, even in the same second', async () => {
    const { check } = guard(revokedAt);
    await expect(
      check(claims(revokedAt.getTime() - 100), { background: false }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      check(claims(revokedAt.getTime()), { background: false }),
    ).resolves.toBeUndefined();
  });

  it('lets every token through when sessions were never ended, and checks super admin sessions', async () => {
    const { check, checkSession } = guard(null);
    await check(claims(0, 'family'), { background: true });
    expect(checkSession).toHaveBeenCalledWith('family', { background: true });
  });
});

describe('the reveal service without MFA_ENCRYPTION_KEY', () => {
  it('refuses to deliver rather than store a readable password', async () => {
    const create = vi.fn();
    const service = createRevealService({
      reveals: { create } as never,
      secrets: null,
      notifications: { notify: vi.fn() },
      audit: { record: vi.fn() },
    });
    await expect(
      service.deliver({
        recipientId: 'issc',
        purpose: 'account_created',
        issuedById: 'dev',
        title: 't',
        body: 'b',
        entries: [
          {
            organization: { acronym: 'JPICE', name: 'JPICE', type: 'SBO' },
            email: 'jpice@nwssu.test',
            temporaryPassword: 'x',
            officerInCharge: null,
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('the reveal service’s hourly sweep', () => {
  it('erases the copies nobody revealed in time', async () => {
    const purgeExpired = vi.fn(() => Promise.resolve(3));
    const at = new Date('2026-10-27T00:00:00Z');
    const service = createRevealService({
      reveals: { purgeExpired } as never,
      secrets: null,
      notifications: { notify: vi.fn() },
      audit: { record: vi.fn() },
      now: () => at,
    });
    expect(await service.purgeExpired()).toBe(3);
    expect(purgeExpired).toHaveBeenCalledWith(at);
  });
});
