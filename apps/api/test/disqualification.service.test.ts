import { describe, expect, it, vi } from 'vitest';
import type { DisqualificationRecord } from '#src/repositories/disqualification.repository';
import { createDisqualificationService } from '#src/services/disqualification.service';

const FIRST = { academicYear: '2026-2027', semester: 'first' as const };
const CTX = { ip: '127.0.0.1', userAgent: 'test' };
const ORG = { id: '0195f3c0-0000-7000-8000-0000000000a1', name: 'JPICE', acronym: 'JPICE' };
const ID = '0195f3c0-0000-7000-8000-0000000000d1';
const INPUT = {
  organizationId: ORG.id,
  ...FIRST,
  reason: 'Falsified attendance sheets.',
  actingAs: 'Ana Reyes',
};
const LIFT = { reason: 'The sheets were checked again.', actingAs: 'Ana Reyes' };
const AT = new Date('2026-11-02T04:00:00Z');

const record = (over: Partial<DisqualificationRecord> = {}): DisqualificationRecord => ({
  id: ID,
  ...FIRST,
  reason: INPUT.reason,
  actingAs: INPUT.actingAs,
  createdAt: AT,
  liftedAt: null,
  liftReason: null,
  liftActingAs: null,
  organization: { ...ORG, type: 'SBO' },
  ...over,
});

function setup({ status = 'provisional', officers = ['u9'] } = {}) {
  const disqualifications = {
    list: vi.fn(() => Promise.resolve([record()])),
    findById: vi.fn(() => Promise.resolve<DisqualificationRecord | null>(record())),
    rankedOrganizations: vi.fn(() =>
      Promise.resolve<
        { id: string; name: string; acronym: string; type: 'SBO' | 'CSC' | 'ISSC' }[]
      >([{ ...ORG, type: 'SBO' }]),
    ),
    create: vi.fn(() => Promise.resolve<DisqualificationRecord | null>(record())),
    lift: vi.fn(() => Promise.resolve(true)),
  };
  const leaderboard = {
    meta: vi.fn(() =>
      Promise.resolve({
        status: status as 'provisional' | 'final',
        provisionalUntil: '2027-01-07',
        latePoints: 0.5,
      }),
    ),
  };
  const recompute = { forSemesters: vi.fn(() => Promise.resolve()) };
  const recipients = { officersOf: vi.fn(() => Promise.resolve(officers)) };
  const notifications = { notify: vi.fn((_input: object) => Promise.resolve()) };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  const service = createDisqualificationService({
    disqualifications,
    leaderboard,
    recompute,
    recipients,
    notifications,
    audit,
    now: () => AT,
  });
  return { service, disqualifications, recompute, notifications, audit };
}

describe('disqualifications.list', () => {
  it('gives the status, the records and who can be disqualified', async () => {
    const res = await setup().service.list(FIRST);
    expect(res.status).toBe('provisional');
    expect(res.items).toEqual([
      expect.objectContaining({ id: ID, reason: INPUT.reason, lifted: null }),
    ]);
    expect(res.organizations).toEqual([{ ...ORG, type: 'SBO' }]);
  });

  it('shows a lifted one with why', async () => {
    const { service, disqualifications } = setup();
    disqualifications.list.mockResolvedValueOnce([
      record({ liftedAt: AT, liftReason: LIFT.reason, liftActingAs: 'Ben' }),
    ]);
    const { items } = await service.list(FIRST);
    expect(items[0]!.lifted).toEqual({
      reason: LIFT.reason,
      actingAs: 'Ben',
      at: AT.toISOString(),
    });
  });
});

describe('disqualifications.disqualify', () => {
  it('records it, audits with acting-as, recomputes and tells the organization', async () => {
    const { service, disqualifications, recompute, notifications, audit } = setup();
    await service.disqualify('issc', INPUT, CTX);
    expect(disqualifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ createdById: 'issc', reason: INPUT.reason }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'leaderboard_disqualify',
        actorId: 'issc',
        organizationId: ORG.id,
        actingAs: 'Ana Reyes',
        metadata: { ...FIRST, reason: INPUT.reason },
      }),
    );
    expect(recompute.forSemesters).toHaveBeenCalledWith(FIRST);
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['u9'],
        kind: 'leaderboard_penalty',
        dedupeKey: `disqualified:${ID}`,
      }),
    );
  });

  it('tells nobody when the organization has no active account', async () => {
    const { service, notifications } = setup({ officers: [] });
    await service.disqualify('issc', INPUT, CTX);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('409s once the standings are final', async () => {
    const { service, disqualifications } = setup({ status: 'final' });
    await expect(service.disqualify('issc', INPUT, CTX)).rejects.toMatchObject({ status: 409 });
    expect(disqualifications.create).not.toHaveBeenCalled();
  });

  it('404s an organization that cannot be ranked, such as the ISSC', async () => {
    const { service, disqualifications } = setup();
    disqualifications.rankedOrganizations.mockResolvedValueOnce([]);
    await expect(service.disqualify('issc', INPUT, CTX)).rejects.toMatchObject({ status: 404 });
  });

  it('409s a second standing one', async () => {
    const { service, disqualifications, recompute } = setup();
    disqualifications.create.mockResolvedValueOnce(null);
    await expect(service.disqualify('issc', INPUT, CTX)).rejects.toMatchObject({ status: 409 });
    expect(recompute.forSemesters).not.toHaveBeenCalled();
  });
});

describe('disqualifications.lift', () => {
  it('lifts it, audits, recomputes and tells the organization', async () => {
    const { service, disqualifications, recompute, notifications, audit } = setup();
    disqualifications.findById
      .mockResolvedValueOnce(record())
      .mockResolvedValueOnce(
        record({ liftedAt: AT, liftReason: LIFT.reason, liftActingAs: 'Ana' }),
      );
    const res = await service.lift('issc', ID, LIFT, CTX);
    expect(disqualifications.lift).toHaveBeenCalledWith(ID, {
      ...LIFT,
      byId: 'issc',
      at: AT,
    });
    expect(res.lifted?.reason).toBe(LIFT.reason);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'leaderboard_disqualification_lift',
        entityId: ID,
        actingAs: 'Ana Reyes',
      }),
    );
    expect(recompute.forSemesters).toHaveBeenCalledWith(FIRST);
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: `disqualification-lifted:${ID}` }),
    );
  });

  it('404s an unknown one', async () => {
    const { service, disqualifications } = setup();
    disqualifications.findById.mockResolvedValueOnce(null);
    await expect(service.lift('issc', ID, LIFT, CTX)).rejects.toMatchObject({ status: 404 });
  });

  it('409s one already lifted', async () => {
    const { service, disqualifications, recompute } = setup();
    disqualifications.lift.mockResolvedValueOnce(false);
    await expect(service.lift('issc', ID, LIFT, CTX)).rejects.toMatchObject({ status: 409 });
    expect(recompute.forSemesters).not.toHaveBeenCalled();
  });

  it('409s once the standings are final', async () => {
    const { service, disqualifications } = setup({ status: 'final' });
    await expect(service.lift('issc', ID, LIFT, CTX)).rejects.toMatchObject({ status: 409 });
    expect(disqualifications.lift).not.toHaveBeenCalled();
  });
});
