import { describe, expect, it, vi } from 'vitest';
import { memoryLeaderboardStore } from '#src/lib/leaderboard-store';
import type {
  SnapshotKey,
  SnapshotRecord,
  StandingOrgRecord,
} from '#src/repositories/leaderboard.repository';
import {
  createLeaderboardService,
  standingFactsOf,
  type LeaderboardRow,
} from '#src/services/leaderboard.service';

const SEMESTER = { academicYear: '2026-2027', semester: 'first' as const };
const NOW = new Date('2026-12-01T02:00:00Z');
const CREATED = new Date('2026-10-01T02:00:00Z');
const ON_TIME = new Date('2026-10-25T02:00:00Z');
const LATE = new Date('2026-11-10T02:00:00Z');

type Doc = {
  status: 'available' | 'scanning' | 'quarantined' | 'archived';
  deletedAt: Date | null;
};
const clean: Doc = { status: 'available', deletedAt: null };

function project(
  reports: Date = ON_TIME,
  incomeCentavos = 10_000,
  doc: Doc = clean,
): StandingOrgRecord['projects'][number] {
  return {
    createdAt: CREATED,
    targetDate: new Date('2026-10-20T00:00:00Z'),
    nomRequired: false,
    momRequired: false,
    tasks: [
      { type: 'PROPOSAL', submittedAt: new Date('2026-10-05T02:00:00Z'), document: clean },
      { type: 'ACR', submittedAt: reports, document: doc },
      { type: 'FINANCIAL_REPORT', submittedAt: ON_TIME, document: clean },
    ],
    figures: { incomeCentavos, expensesCentavos: 0, flaggedAt: null },
  };
}

function org(
  id: string,
  type: 'SBO' | 'CSC',
  projects: StandingOrgRecord['projects'],
): StandingOrgRecord {
  return { id, type, name: id.toUpperCase(), projects };
}

function setup(records: StandingOrgRecord[], now = () => NOW) {
  const snapshots: (SnapshotKey & SnapshotRecord)[] = [];
  const leaderboard = {
    standingFacts: vi.fn(() => Promise.resolve(records)),
    latestSnapshot: vi.fn((key: SnapshotKey) => {
      const mine = snapshots.filter(
        (s) =>
          s.academicYear === key.academicYear && s.semester === key.semester && s.type === key.type,
      );
      return Promise.resolve(mine.at(-1) ?? null);
    }),
    saveSnapshot: vi.fn((key: SnapshotKey, rows: readonly object[], at: Date) => {
      snapshots.push({ ...key, rows: structuredClone(rows) as never, computedAt: at });
      return Promise.resolve();
    }),
  };
  const settings = { latePoints: vi.fn(() => Promise.resolve(0.5)) };
  const store = memoryLeaderboardStore();
  const service = createLeaderboardService({ leaderboard, settings, store, now });
  return { service, leaderboard, settings, store, snapshots };
}

describe('standingFactsOf', () => {
  it('keeps only tasks whose file is still filed', () => {
    const facts = standingFactsOf(
      org('jpice', 'SBO', [
        project(ON_TIME, 1, { status: 'available', deletedAt: new Date() }),
        project(ON_TIME, 1, { status: 'quarantined', deletedAt: null }),
        project(ON_TIME, 1, { status: 'archived', deletedAt: null }),
      ]),
    );
    expect(facts.projects.map((p) => Object.keys(p.submitted).sort())).toEqual([
      ['FINANCIAL_REPORT', 'PROPOSAL'],
      ['FINANCIAL_REPORT', 'PROPOSAL'],
      ['ACR', 'FINANCIAL_REPORT', 'PROPOSAL'],
    ]);
    expect(facts.projects[0]!.targetDate).toBe('2026-10-20');
    expect(facts.projects[0]!.figures).toEqual({
      incomeCentavos: 1,
      expensesCentavos: 0,
      underReview: false,
    });
  });

  it('marks flagged figures under review', () => {
    const flagged = {
      ...project(),
      figures: { incomeCentavos: 1, expensesCentavos: 0, flaggedAt: NOW },
    };
    expect(standingFactsOf(org('a', 'SBO', [flagged])).projects[0]!.figures?.underReview).toBe(
      true,
    );
  });
});

describe('leaderboardService.compute', () => {
  it('ranks both boards with the late value, stores them and snapshots each', async () => {
    const { service, store, snapshots, leaderboard, settings } = setup([
      org('jpice', 'SBO', [project(), project(LATE)]),
      org('psme', 'SBO', [project()]),
      org('csc-cea', 'CSC', [project()]),
    ]);
    const boards = await service.compute(SEMESTER);
    expect(leaderboard.standingFacts).toHaveBeenCalledWith({
      start: '2026-08-01',
      end: '2026-12-31',
    });
    expect(settings.latePoints).toHaveBeenCalled();
    expect(boards.SBO.map((r) => [r.organizationId, r.points, r.rank, r.rankChange])).toEqual([
      ['jpice', 1.5, 1, null],
      ['psme', 1, 2, null],
    ]);
    expect(boards.CSC.map((r) => r.organizationId)).toEqual(['csc-cea']);
    expect(snapshots.map((s) => s.type)).toEqual(['SBO', 'CSC']);
    expect(await store.read({ ...SEMESTER, type: 'SBO' })).toEqual(boards.SBO);
  });

  it('shows places gained and lost since the standings last changed', async () => {
    const records = [org('jpice', 'SBO', [project()]), org('psme', 'SBO', [project(ON_TIME, 1)])];
    const { service } = setup(records);
    await service.compute(SEMESTER);
    // PSME completes two more projects and passes JPICE.
    records[1] = org('psme', 'SBO', [project(), project(), project()]);
    const { SBO } = await service.compute(SEMESTER);
    expect(SBO.map((r) => [r.organizationId, r.rank, r.rankChange])).toEqual([
      ['psme', 1, 1],
      ['jpice', 2, -1],
    ]);
  });

  it('writes no new snapshot when nothing changed, and keeps the arrows', async () => {
    const records = [org('jpice', 'SBO', [project()]), org('psme', 'SBO', [project(ON_TIME, 1)])];
    const { service, snapshots } = setup(records);
    await service.compute(SEMESTER);
    records.reverse();
    records[0] = org('psme', 'SBO', [project(), project()]);
    await service.compute(SEMESTER);
    const count = snapshots.length;
    const { SBO } = await service.compute(SEMESTER);
    expect(snapshots.length).toBe(count);
    expect(SBO.find((r) => r.organizationId === 'psme')?.rankChange).toBe(1);
  });

  it('snapshots unchanged standings again after a day, for the history', async () => {
    let now = NOW;
    const { service, snapshots } = setup([org('jpice', 'SBO', [project()])], () => now);
    await service.compute(SEMESTER);
    now = new Date(NOW.getTime() + 23 * 60 * 60 * 1000);
    await service.compute(SEMESTER);
    expect(snapshots.filter((s) => s.type === 'SBO')).toHaveLength(1);
    now = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    await service.compute(SEMESTER);
    expect(snapshots.filter((s) => s.type === 'SBO')).toHaveLength(2);
  });

  it('treats an unreadable snapshot as none', async () => {
    const { service, leaderboard } = setup([org('jpice', 'SBO', [project()])]);
    leaderboard.latestSnapshot.mockResolvedValue({
      rows: { not: 'rows' },
      computedAt: NOW,
    } as never);
    const { SBO } = await service.compute(SEMESTER);
    expect(SBO[0]?.rankChange).toBeNull();
  });

  it('stores empty boards for a semester with nothing implemented', async () => {
    const { service, store } = setup([org('jpice', 'SBO', [])]);
    expect(await service.compute(SEMESTER)).toEqual({ SBO: [], CSC: [] });
    expect(await store.read({ ...SEMESTER, type: 'CSC' })).toEqual([]);
  });
});

describe('leaderboardService.board', () => {
  it('reads the stored board without recomputing', async () => {
    const { service, store, leaderboard } = setup([]);
    const rows = [{ organizationId: 'x', rank: 1 }] as LeaderboardRow[];
    await store.write({ ...SEMESTER, type: 'SBO' }, rows);
    expect(await service.board(SEMESTER, 'SBO')).toEqual(rows);
    expect(leaderboard.standingFacts).not.toHaveBeenCalled();
  });

  it('computes a board the store does not hold', async () => {
    const { service } = setup([org('csc-cea', 'CSC', [project()])]);
    const rows = await service.board(SEMESTER, 'CSC');
    expect(rows.map((r) => r.organizationId)).toEqual(['csc-cea']);
  });
});
