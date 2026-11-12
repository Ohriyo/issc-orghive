import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { Mailer } from '#src/lib/mailer';
import type { AuditEntry } from '#src/repositories/audit-log.repository';
import { createEmailTestService } from '#src/services/email-test.service';

const T0 = new Date('2026-11-12T01:00:00Z');
const actor = { userId: 'dev', ctx: { ip: '203.0.113.9', userAgent: 'vitest' } };

function setup(send: Mailer['send'], email: string | null = 'dev@nwssu.test', timeoutMs?: number) {
  const audit: AuditEntry[] = [];
  const mailer = { send: vi.fn(send) };
  const service = createEmailTestService({
    mailer,
    users: {
      findById: () => Promise.resolve(email ? ({ id: 'dev', email } as never) : null),
    },
    audit: {
      record: (entry) => {
        audit.push(entry);
        return Promise.resolve();
      },
    },
    logger: pino({ level: 'silent' }),
    now: () => T0,
    ...(timeoutMs !== undefined && { timeoutMs }),
  });
  return { service, mailer, audit };
}

describe('emailTest.send', () => {
  it("sends to the super admin's own address by default, and audits the delivery", async () => {
    const { service, mailer, audit } = setup(() => Promise.resolve());
    const result = await service.send(actor, undefined);
    expect(result).toMatchObject({
      to: 'dev@nwssu.test',
      delivered: true,
      error: null,
      sentAt: T0.toISOString(),
    });
    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'dev@nwssu.test', subject: 'Orghive test email' }),
    );
    expect(audit[0]).toMatchObject({
      action: 'email_test',
      actorId: 'dev',
      metadata: { to: 'dev@nwssu.test', delivered: true, error: null },
    });
  });

  it('sends to another address and reports what the relay said when it fails', async () => {
    const { service, audit } = setup(() => Promise.reject(new Error('550 relay denied')));
    const result = await service.send(actor, 'it@nwssu.test');
    expect(result).toMatchObject({
      to: 'it@nwssu.test',
      delivered: false,
      error: '550 relay denied',
    });
    expect(audit[0]).toMatchObject({ metadata: { delivered: false, error: '550 relay denied' } });
  });

  it('gives up on a relay that does not answer', async () => {
    const { service } = setup(() => new Promise<void>(() => undefined), 'dev@nwssu.test', 10);
    const result = await service.send(actor, undefined);
    expect(result).toMatchObject({ delivered: false, error: 'timed out after 10 ms' });
  });

  it('refuses when the account has no address', async () => {
    const { service } = setup(() => Promise.resolve(), null);
    await expect(service.send(actor, undefined)).rejects.toMatchObject({ status: 404 });
  });
});

describe('emailTest defaults', () => {
  it('stamps the send with the real clock when none is given', async () => {
    const before = Date.now();
    const service = createEmailTestService({
      mailer: { send: () => Promise.resolve() },
      users: { findById: () => Promise.resolve({ id: 'dev', email: 'dev@nwssu.test' } as never) },
      audit: { record: () => Promise.resolve() },
      logger: pino({ level: 'silent' }),
    });
    const result = await service.send(actor, undefined);
    expect(new Date(result.sentAt).getTime()).toBeGreaterThanOrEqual(before);
  });
});
