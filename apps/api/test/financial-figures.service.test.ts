import { describe, expect, it, vi } from 'vitest';
import type { FiguresRecord } from '#src/repositories/financial-figures.repository';
import type { ProjectRecord } from '#src/repositories/project.repository';
import {
  createFinancialFiguresService,
  toFiguresView,
} from '#src/services/financial-figures.service';

const ACTOR = { userId: 'u1', ip: '10.0.0.1' };
const JPICE = { id: 'jpice', slug: 'jpice', type: 'SBO' as const };
const CTX = { ip: '10.0.0.9', userAgent: 'test' };
/** Event Oct 20 (1st semester): the figures close Dec 31, 23:59:59.999 Manila. */
const OPEN = new Date('2026-11-10T02:00:00Z');
const CLOSED = new Date('2027-01-01T02:00:00Z');

function stored(overrides: Partial<FiguresRecord> = {}): FiguresRecord {
  return {
    incomeCentavos: 50_000,
    expensesCentavos: 20_000,
    flaggedAt: null,
    flagRemark: null,
    updatedAt: new Date('2026-10-25T02:00:00Z'),
    ...overrides,
  };
}

function record(figures: FiguresRecord | null = stored()): ProjectRecord {
  return {
    id: 'p1',
    organizationId: 'jpice',
    name: 'Tree Planting',
    targetDate: new Date('2026-10-20T00:00:00Z'),
    postEventDueOverride: null,
    organization: { id: 'jpice', slug: 'jpice', acronym: 'JPICE', name: 'JPICE', type: 'SBO' },
    figures,
  } as ProjectRecord;
}

function setup(found: ProjectRecord | null = record(), now = OPEN) {
  const figures = {
    save: vi.fn((_id: string, amounts: { incomeCentavos: number; expensesCentavos: number }) =>
      Promise.resolve({ before: found?.figures ?? null, after: stored(amounts) }),
    ),
    flag: vi.fn((_id: string, flag: { remark: string; at: Date }) =>
      Promise.resolve(
        found?.figures ? stored({ flaggedAt: flag.at, flagRemark: flag.remark }) : null,
      ),
    ),
    clearFlag: vi.fn(() => Promise.resolve(true)),
    listSubmitted: vi.fn(() => Promise.resolve([])),
  };
  const projects = { findById: vi.fn(() => Promise.resolve(found)) };
  const recipients = { officersOf: vi.fn(() => Promise.resolve(['acct-jpice'])) };
  const notifications = { notify: vi.fn(() => Promise.resolve()) };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  const leaderboard = { forEventDates: vi.fn(() => Promise.resolve()) };
  const service = createFinancialFiguresService({
    figures: figures as never,
    projects,
    recipients,
    notifications,
    audit,
    leaderboard,
    now: () => now,
  });
  return { service, figures, projects, recipients, notifications, audit, leaderboard };
}

describe('toFiguresView', () => {
  it('shows net profit, the review and until when they can be corrected', () => {
    const view = toFiguresView(
      record(stored({ flaggedAt: new Date('2026-11-01T02:00:00Z'), flagRemark: 'Check receipts' })),
    );
    expect(view).toEqual({
      incomeCentavos: 50_000,
      expensesCentavos: 20_000,
      netCentavos: 30_000,
      underReview: { remark: 'Check receipts', flaggedAt: '2026-11-01T02:00:00.000Z' },
      correctableUntil: '2026-12-31T15:59:59.999Z',
      updatedAt: '2026-10-25T02:00:00.000Z',
    });
  });

  it('is null before the totals are entered', () => {
    expect(toFiguresView(record(null))).toBeNull();
  });
});

describe('financialFiguresService.saveWithFile', () => {
  it('saves the first entry and audits it with no "before"', async () => {
    const { service, figures, audit } = setup(record(null));
    const view = await service.saveWithFile(
      ACTOR,
      record(null),
      { incomeCentavos: 900, expensesCentavos: 1_000 },
      'Juan',
    );
    expect(figures.save).toHaveBeenCalledWith('p1', {
      incomeCentavos: 900,
      expensesCentavos: 1_000,
    });
    expect(view.netCentavos).toBe(-100);
    expect(audit.record).toHaveBeenCalledWith({
      action: 'financial_figures_change',
      actorId: 'u1',
      entityType: 'project',
      entityId: 'p1',
      organizationId: 'jpice',
      metadata: { before: null, after: { incomeCentavos: 900, expensesCentavos: 1_000 } },
      ip: '10.0.0.1',
      actingAs: 'Juan',
    });
  });

  it('does nothing when a new version keeps the same totals, even after the semester', async () => {
    const { service, figures, audit, leaderboard } = setup(record(), CLOSED);
    await service.saveWithFile(
      ACTOR,
      record(),
      { incomeCentavos: 50_000, expensesCentavos: 20_000 },
      'Juan',
    );
    expect(figures.save).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(leaderboard.forEventDates).not.toHaveBeenCalled();
  });

  it('enters first totals even after the semester closed (a late report)', async () => {
    const { service, figures } = setup(record(null), CLOSED);
    await service.saveWithFile(
      ACTOR,
      record(null),
      { incomeCentavos: 1, expensesCentavos: 0 },
      'Juan',
    );
    expect(figures.save).toHaveBeenCalled();
  });

  it('refuses to change totals once the semester closed', async () => {
    const { service, figures } = setup(record(), CLOSED);
    await expect(
      service.saveWithFile(ACTOR, record(), { incomeCentavos: 1, expensesCentavos: 0 }, 'Juan'),
    ).rejects.toMatchObject({ status: 409 });
    expect(figures.save).not.toHaveBeenCalled();
  });
});

describe('financialFiguresService.correct', () => {
  const body = { incomeCentavos: 70_000, expensesCentavos: 20_000, actingAs: 'Maria' };

  it('corrects and audits before and after', async () => {
    const { service, audit, leaderboard } = setup();
    const view = await service.correct(ACTOR, JPICE, 'p1', body);
    expect(view.netCentavos).toBe(50_000);
    // The profit total moves: the project's semester is recomputed.
    expect(leaderboard.forEventDates).toHaveBeenCalledWith(new Date('2026-10-20T00:00:00Z'));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actingAs: 'Maria',
        metadata: {
          before: { incomeCentavos: 50_000, expensesCentavos: 20_000 },
          after: { incomeCentavos: 70_000, expensesCentavos: 20_000 },
        },
      }),
    );
  });

  it('404s a project of another organization', async () => {
    const { service } = setup();
    await expect(
      service.correct(ACTOR, { ...JPICE, id: 'psme' }, 'p1', body),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('404s a missing project and 409s one without totals', async () => {
    await expect(setup(null).service.correct(ACTOR, JPICE, 'p1', body)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      setup(record(null)).service.correct(ACTOR, JPICE, 'p1', body),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('financialFiguresService.flag', () => {
  it('flags, audits and tells the organization once', async () => {
    const { service, figures, audit, notifications, leaderboard } = setup();
    const item = await service.flag('issc', 'p1', 'Receipts do not add up', CTX);
    expect(leaderboard.forEventDates).toHaveBeenCalledWith(new Date('2026-10-20T00:00:00Z'));
    expect(figures.flag).toHaveBeenCalledWith('p1', {
      remark: 'Receipts do not add up',
      flaggedById: 'issc',
      at: OPEN,
    });
    expect(item).toMatchObject({
      projectId: 'p1',
      projectName: 'Tree Planting',
      underReview: { remark: 'Receipts do not add up' },
      organization: { slug: 'jpice' },
    });
    expect(audit.record).toHaveBeenCalledWith({
      action: 'financial_figures_flag',
      actorId: 'issc',
      entityType: 'project',
      entityId: 'p1',
      organizationId: 'jpice',
      metadata: { remark: 'Receipts do not add up' },
      ip: '10.0.0.9',
      userAgent: 'test',
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['acct-jpice'],
        kind: 'figures_review',
        link: '/projects/p1',
        dedupeKey: `figures-flag:p1:${OPEN.toISOString()}`,
      }),
    );
    const [[sent]] = notifications.notify.mock.calls as unknown as [[{ body: string }]];
    expect(sent.body).toContain('₱300.00');
  });

  it('404s without totals, and notifies nobody when the organization has no account', async () => {
    await expect(setup(record(null)).service.flag('issc', 'p1', 'x', CTX)).rejects.toMatchObject({
      status: 404,
    });
    await expect(setup(null).service.flag('issc', 'p1', 'x', CTX)).rejects.toMatchObject({
      status: 404,
    });
    const { service, recipients, notifications } = setup();
    recipients.officersOf.mockResolvedValueOnce([]);
    await service.flag('issc', 'p1', 'Check', CTX);
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});

describe('financialFiguresService.clearFlag', () => {
  const flagged = record(
    stored({ flaggedAt: new Date('2026-11-01T02:00:00Z'), flagRemark: 'Check' }),
  );

  it('clears, audits the old remark and tells the organization', async () => {
    const { service, audit, notifications, leaderboard } = setup(flagged);
    const item = await service.clearFlag('issc', 'p1', CTX);
    expect(item.underReview).toBeNull();
    expect(leaderboard.forEventDates).toHaveBeenCalledWith(new Date('2026-10-20T00:00:00Z'));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'financial_figures_unflag',
        metadata: { remark: 'Check' },
      }),
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'figures_review' }),
    );
  });

  it('is a no-op when nothing was flagged', async () => {
    const { service, figures, audit, notifications, leaderboard } = setup();
    figures.clearFlag.mockResolvedValueOnce(false);
    await service.clearFlag('issc', 'p1', CTX);
    expect(audit.record).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(leaderboard.forEventDates).not.toHaveBeenCalled();
  });

  it('404s without totals', async () => {
    await expect(setup(record(null)).service.clearFlag('issc', 'p1', CTX)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('financialFiguresService.list', () => {
  it('lists the semester’s submitted figures', async () => {
    const { service, figures } = setup();
    figures.listSubmitted.mockResolvedValueOnce([
      {
        ...stored({ flaggedAt: new Date('2026-11-01T02:00:00Z'), flagRemark: 'Check' }),
        projectId: 'p1',
        project: {
          name: 'Tree Planting',
          targetDate: new Date('2026-10-20T00:00:00Z'),
          organization: { slug: 'jpice', acronym: 'JPICE', name: 'JPICE' },
        },
      },
    ] as never);
    const res = await service.list({ academicYear: '2026-2027', semester: 'first' });
    expect(figures.listSubmitted).toHaveBeenCalledWith({ start: '2026-08-01', end: '2026-12-31' });
    expect(res.items).toEqual([
      {
        incomeCentavos: 50_000,
        expensesCentavos: 20_000,
        netCentavos: 30_000,
        underReview: { remark: 'Check', flaggedAt: '2026-11-01T02:00:00.000Z' },
        updatedAt: '2026-10-25T02:00:00.000Z',
        projectId: 'p1',
        projectName: 'Tree Planting',
        targetDate: '2026-10-20',
        organization: { slug: 'jpice', acronym: 'JPICE', name: 'JPICE' },
      },
    ]);
  });
});
