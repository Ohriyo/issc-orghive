import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { RateLimitHitReader } from '#src/lib/rate-limit-hits';
import { summarizeRateLimitHits } from '#src/lib/rate-limit-hits';
import type { SecurityCenterRepository } from '#src/repositories/security-center.repository';
import { createSecurityCenterService } from '#src/services/security-center.service';

const T0 = new Date('2026-11-12T08:00:00Z');
const EARLIER = new Date('2026-11-12T07:00:00Z');

function setup(
  hits: RateLimitHitReader['read'] = () =>
    Promise.resolve({
      total: 3,
      byLimiter: [{ limiter: 'login-ip', hits: 3 }],
      byIp: [{ ip: '198.51.100.7', hits: 3, limiters: ['login-ip'] }],
    }),
) {
  const security = {
    countFailedSignIns: vi.fn(() => Promise.resolve(7)),
    failedSignInsByIp: vi.fn(() =>
      Promise.resolve([{ ip: '198.51.100.7', count: 5, lastAt: EARLIER }]),
    ),
    failedSignInsByAccount: vi.fn(() =>
      Promise.resolve([
        {
          userId: 'u1',
          email: 'jpice@nwssu.test',
          organization: 'JPICE',
          count: 4,
          lastAt: EARLIER,
        },
        { userId: null, email: 'nobody@nwssu.test', organization: null, count: 3, lastAt: EARLIER },
      ]),
    ),
    lockedAccounts: vi.fn(() =>
      Promise.resolve([
        {
          id: 'u2',
          email: 'psme@nwssu.test',
          lockedAt: EARLIER,
          lockReason: 'End of term',
          organization: { acronym: 'PSME' },
        },
      ]),
    ),
    superAdminLockouts: vi.fn(() =>
      Promise.resolve([
        {
          createdAt: EARLIER,
          actorId: 'dev',
          ip: '198.51.100.7',
          actor: { email: 'dev@nwssu.test' },
        },
      ]),
    ),
    recentAdminActions: vi.fn(() =>
      Promise.resolve([
        {
          id: 'log1',
          createdAt: EARLIER,
          action: 'cache_flush' as const,
          actor: { id: 'dev', name: 'Developer', email: 'dev@nwssu.test' },
          entityType: 'cache',
          entityId: 'organizations',
          organizationId: null,
          ip: null,
          userAgent: null,
          actingAs: null,
          metadata: { deleted: 3 },
        },
      ]),
    ),
    quarantined: vi.fn(() =>
      Promise.resolve({
        total: 3,
        items: [
          quarantined('d1', 'public', 'Accomplishment Report', 'infected', 'Eicar-Test-Signature'),
          quarantined('d2', 'private', 'Secret minutes', 'rejected', 'No valid task code'),
          quarantined('d3', 'governing', 'Budget', null, null),
        ],
      }),
    ),
  };
  const service = createSecurityCenterService({
    security: security as unknown as SecurityCenterRepository,
    rateLimitHits: { read: vi.fn(hits) },
    logger: pino({ level: 'silent' }),
    now: () => T0,
  });
  return { service, security };
}

function quarantined(
  id: string,
  visibility: 'public' | 'private' | 'governing',
  title: string,
  scanStatus: 'infected' | 'rejected' | null,
  failureReason: string | null,
) {
  return {
    id,
    title,
    visibility,
    createdAt: EARLIER,
    organization: { acronym: 'JPICE', slug: 'jpice' },
    versions: scanStatus
      ? [
          {
            scanStatus,
            failureReason,
            mimeType: 'application/pdf',
            sizeBytes: 1200,
            processedAt: EARLIER,
          },
        ]
      : [],
  };
}

describe('securityCenter.read', () => {
  it('gathers the last 24 hours, hiding private titles', async () => {
    const { service, security } = setup();
    const page = await service.read('24h');
    expect(page.since).toBe(new Date(T0.getTime() - 24 * 3600_000).toISOString());
    expect(security.failedSignInsByIp).toHaveBeenCalledWith(new Date(page.since), 20);
    expect(page.failedLogins).toEqual({
      total: 7,
      byIp: [{ ip: '198.51.100.7', count: 5, lastAt: EARLIER.toISOString() }],
      byAccount: [
        {
          userId: 'u1',
          email: 'jpice@nwssu.test',
          organization: 'JPICE',
          count: 4,
          lastAt: EARLIER.toISOString(),
        },
        {
          userId: null,
          email: 'nobody@nwssu.test',
          organization: null,
          count: 3,
          lastAt: EARLIER.toISOString(),
        },
      ],
    });
    expect(page.lockedAccounts).toEqual([
      {
        userId: 'u2',
        email: 'psme@nwssu.test',
        organization: 'PSME',
        lockedAt: EARLIER.toISOString(),
        reason: 'End of term',
      },
    ]);
    expect(page.superAdminLockouts).toEqual([
      { at: EARLIER.toISOString(), userId: 'dev', email: 'dev@nwssu.test', ip: '198.51.100.7' },
    ]);
    expect(page.rateLimitHits.total).toBe(3);
    expect(page.recentAdminActions[0]).toMatchObject({
      action: 'cache_flush',
      metadata: { deleted: 3 },
    });
    expect(page.quarantined.total).toBe(3);
    expect(page.quarantined.items).toEqual([
      expect.objectContaining({
        documentId: 'd1',
        title: 'Accomplishment Report',
        kind: 'virus',
        reason: 'Eicar-Test-Signature',
      }),
      expect.objectContaining({ documentId: 'd2', title: null, kind: 'task_check' }),
      expect.objectContaining({
        documentId: 'd3',
        title: 'Budget',
        kind: 'unknown',
        quarantinedAt: null,
        sizeBytes: 0,
      }),
    ]);
  });

  it('covers 7 days, and still answers when the rate limit counts cannot be read', async () => {
    const { service } = setup(() => Promise.reject(new Error('redis down')));
    const page = await service.read('7d');
    expect(page.since).toBe(new Date(T0.getTime() - 7 * 24 * 3600_000).toISOString());
    expect(page.rateLimitHits).toEqual({ total: 0, byLimiter: [], byIp: [] });
  });
});

describe('summarizeRateLimitHits', () => {
  it('sums hours per limiter and per IP, busiest first', () => {
    const summary = summarizeRateLimitHits(
      [
        { 'login-ip|198.51.100.7': '4', 'viewer|203.0.113.1': '1' },
        {
          'login-ip|198.51.100.7': '2',
          'login-account|198.51.100.7': '1',
          'odd-field': '2',
          'bad|1.1.1.1': 'x',
        },
      ],
      1,
    );
    expect(summary).toEqual({
      total: 10,
      byLimiter: [
        { limiter: 'login-ip', hits: 6 },
        { limiter: 'odd-field', hits: 2 },
        { limiter: 'login-account', hits: 1 },
        { limiter: 'viewer', hits: 1 },
      ],
      byIp: [{ ip: '198.51.100.7', hits: 7, limiters: ['login-account', 'login-ip'] }],
    });
  });
});
