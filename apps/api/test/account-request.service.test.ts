import { describe, expect, it, vi } from 'vitest';
import { createAccountRequestService } from '#src/services/account-request.service';

/** The service's email to the super admins, which runs after the request is answered. */
describe('accountRequestService.request: alerting the super admins', () => {
  const org = { id: 'org-1', acronym: 'R&D <Club>', _count: { accounts: 0 } };
  const record = {
    id: 'req-1',
    status: 'requested' as const,
    createdAt: new Date('2026-10-20T00:00:00Z'),
  };

  function setup(send: () => Promise<void>) {
    const error = vi.fn();
    const service = createAccountRequestService({
      requests: {
        create: vi.fn(() => Promise.resolve('req-1')),
        find: vi.fn(() => Promise.resolve(record)),
      } as never,
      orgReads: { findOrganization: vi.fn(() => Promise.resolve(org)) } as never,
      superAdmins: { activeSuperAdminEmails: () => Promise.resolve(['dev@nwssu.test']) },
      mailer: { send: vi.fn(send) },
      notifications: { notify: vi.fn() },
      audit: { record: vi.fn(() => Promise.resolve()) },
      logger: { error },
      webOrigin: 'https://orghive.test',
      emailDomains: [],
    });
    return { service, error };
  }
  const actor = { userId: 'issc', ctx: { ip: '203.0.113.1', userAgent: 'vitest' } };
  const body = {
    accountEmail: 'rd@nwssu.test',
    officerInCharge: { name: 'Rosa Lim', position: 'President', email: 'rosa@nwssu.test' },
  };

  it('escapes the organization’s name in the email', async () => {
    const sent: { html: string; subject: string }[] = [];
    const mail = vi.fn((m: { html: string; subject: string }) => {
      sent.push(m);
      return Promise.resolve();
    });
    const withMail = createAccountRequestService({
      requests: {
        create: () => Promise.resolve('req-1'),
        find: () => Promise.resolve(record),
      } as never,
      orgReads: { findOrganization: () => Promise.resolve(org) } as never,
      superAdmins: { activeSuperAdminEmails: () => Promise.resolve(['dev@nwssu.test']) },
      mailer: { send: mail },
      notifications: { notify: vi.fn() },
      audit: { record: () => Promise.resolve() },
      logger: { error: vi.fn() },
      webOrigin: 'https://orghive.test',
      emailDomains: [],
    });
    await withMail.request(actor, 'rd', body);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.subject).toBe('Orghive: account requested for R&D <Club>');
    expect(sent[0]!.html).toContain('R&amp;D &lt;Club&gt;');
    expect(sent[0]!.html).not.toContain('<Club>');
  });

  it('logs a failed email instead of failing the request', async () => {
    const { service, error } = setup(() => Promise.reject(new Error('SMTP down')));
    await expect(service.request(actor, 'rd', body)).resolves.toMatchObject({
      status: 'requested',
    });
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(expect.anything(), 'Account request email failed'),
    );
  });

  it('refuses a foreign email domain when domains are set', async () => {
    const service = createAccountRequestService({
      requests: { create: vi.fn() } as never,
      orgReads: { findOrganization: () => Promise.resolve(org) } as never,
      superAdmins: { activeSuperAdminEmails: () => Promise.resolve([]) },
      mailer: { send: vi.fn() },
      notifications: { notify: vi.fn() },
      audit: { record: vi.fn() },
      logger: { error: vi.fn() },
      webOrigin: 'https://orghive.test',
      emailDomains: ['nwssu.edu.ph'],
    });
    await expect(service.request(actor, 'rd', body)).rejects.toMatchObject({ status: 400 });
  });
});
