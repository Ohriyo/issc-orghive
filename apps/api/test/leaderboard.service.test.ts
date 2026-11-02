import { describe, expect, it, vi } from 'vitest';
import { semesterCalendar, type SemesterCalendar, type SemesterKey } from '@orghive/shared';
import type { IntegrityDocumentRecord } from '#src/repositories/integrity-select';
import { verifiedDoc } from './integrity-fixtures';
import { memoryLeaderboardEvents } from '#src/lib/leaderboard-events';
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

type Doc = IntegrityDocumentRecord;
const clean: Doc = verifiedDoc();

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
    communicationLetterRequired: false,
    attendanceSheetRequired: false,
    tasks: [
      {
        type: 'PROPOSAL',
        submittedAt: new Date('2026-10-05T02:00:00Z'),
        document: clean,
        files: [],
      },
      { type: 'ACR', submittedAt: reports, document: doc, files: [] },
      { type: 'FINANCIAL_REPORT', submittedAt: ON_TIME, document: clean, files: [] },
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

function setup(records: StandingOrgRecord[], now = () => NOW, calendar?: SemesterCalendar) {
  const snapshots: (SnapshotKey & SnapshotRecord)[] = [];
  const finals: { type: string; rows: unknown; latePoints: number | null }[] = [];
  const disqualified: string[] = [];
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
    finalSnapshots: vi.fn(() => Promise.resolve([...finals])),
    saveFinal: vi.fn(
      (
        _semester: SemesterKey,
        boards: { type: 'SBO' | 'CSC'; rows: readonly object[] }[],
        latePoints: number,
      ) => {
        for (const board of boards) {
          finals.push({ type: board.type, rows: structuredClone(board.rows), latePoints });
        }
        return Promise.resolve();
      },
    ),
    disqualifiedIn: vi.fn(() => Promise.resolve([...disqualified])),
  };
  const settings = {
    latePoints: vi.fn(() => Promise.resolve(0.5)),
    finalAfterDays: vi.fn(() => Promise.resolve(7)),
  };
  const store = memoryLeaderboardStore();
  const events = memoryLeaderboardEvents();
  const service = createLeaderboardService({
    leaderboard,
    settings,
    store,
    events,
    now,
    semesters: calendar ? { load: () => Promise.resolve(calendar) } : undefined,
  });
  return { service, leaderboard, settings, store, snapshots, events, finals, disqualified };
}

describe('the provisional → final switch (spec 5B)', () => {
  // The usual 1st semester ends Dec 31; with 7 grace days, Jan 7 is the last provisional day.
  const LAST_PROVISIONAL = new Date('2027-01-07T15:00:00Z'); // 23:00 in Manila
  const FIRST_FINAL = new Date('2027-01-07T16:00:00Z'); // 00:00 on Jan 8 in Manila

  it('stays provisional through the last grace day, without freezing anything', async () => {
    const { service, leaderboard } = setup(
      [org('jpice', 'SBO', [project()])],
      () => LAST_PROVISIONAL,
    );
    await service.compute(SEMESTER);
    expect(leaderboard.saveFinal).not.toHaveBeenCalled();
    await expect(service.meta(SEMESTER)).resolves.toEqual({
      status: 'provisional',
      provisionalUntil: '2027-01-07',
      latePoints: 0.5,
    });
  });

  it('freezes the boards at the first compute after it, and tells the streams', async () => {
    const { service, finals, events } = setup(
      [org('jpice', 'SBO', [project()]), org('csc-cea', 'CSC', [project()])],
      () => FIRST_FINAL,
    );
    await expect(service.meta(SEMESTER)).resolves.toMatchObject({ status: 'final' });
    const boards = await service.compute(SEMESTER);
    expect(finals.map((f) => f.type).sort()).toEqual(['CSC', 'SBO']);
    expect(finals[0]!.latePoints).toBe(0.5);
    expect(boards.SBO[0]!.organizationId).toBe('jpice');
    expect(events.published).toEqual([SEMESTER]);
  });

  it('never changes a final board again: new work, a new late value and a Redis loss', async () => {
    const records = [org('jpice', 'SBO', [project()])];
    const { service, settings, leaderboard, store, events } = setup(records, () => FIRST_FINAL);
    const final = await service.compute(SEMESTER);
    leaderboard.standingFacts.mockClear();
    leaderboard.saveFinal.mockClear();
    events.published.length = 0;

    // Another organization would now rank first, and the late value moved.
    records.unshift(org('asit', 'SBO', [project(), project()]));
    settings.latePoints.mockResolvedValue(0.1);
    store.boards.clear();

    await expect(service.compute(SEMESTER)).resolves.toEqual(final);
    expect(leaderboard.standingFacts).not.toHaveBeenCalled();
    expect(leaderboard.saveFinal).not.toHaveBeenCalled();
    expect(events.published).toEqual([]);
    // The store misses and is filled from the frozen rows.
    await expect(service.board(SEMESTER, 'SBO')).resolves.toEqual(final.SBO);
    // The board keeps explaining itself with the value it was frozen with.
    await expect(service.meta(SEMESTER)).resolves.toMatchObject({
      status: 'final',
      latePoints: 0.5,
    });
  });

  it('stays final after the grace days are raised', async () => {
    let at = FIRST_FINAL;
    const { service, settings } = setup([org('jpice', 'SBO', [project()])], () => at);
    await service.compute(SEMESTER);
    settings.finalAfterDays.mockResolvedValue(30);
    at = new Date('2027-01-08T04:00:00Z');
    await expect(service.meta(SEMESTER)).resolves.toMatchObject({ status: 'final' });
  });

  it('leaves no rows behind for a past semester nobody was ranked in', async () => {
    const { service, leaderboard } = setup([], () => new Date('2030-01-01T00:00:00Z'));
    await expect(service.compute(SEMESTER)).resolves.toEqual({ SBO: [], CSC: [] });
    expect(leaderboard.saveFinal).not.toHaveBeenCalled();
  });

  it('counts from the last day the ISSC set', async () => {
    const calendar = semesterCalendar([{ ...SEMESTER, start: '2026-08-10', end: '2026-12-10' }]);
    const { service, leaderboard } = setup(
      [org('jpice', 'SBO', [project()])],
      () => new Date('2026-12-18T04:00:00Z'), // Dec 18 in Manila: past Dec 10 plus 7 days
      calendar,
    );
    await expect(service.meta(SEMESTER)).resolves.toMatchObject({
      status: 'final',
      provisionalUntil: '2026-12-17',
    });
    await service.compute(SEMESTER);
    expect(leaderboard.saveFinal).toHaveBeenCalledOnce();
    // The break before Dec 10's semester belongs to it; it is asked for by the full span.
    expect(leaderboard.standingFacts).toHaveBeenCalledWith({
      start: '2026-08-01',
      end: '2026-12-10',
    });
  });
});

describe('a disqualified organization (spec 5B)', () => {
  it('leaves the board, and everyone below moves up', async () => {
    const { service, disqualified } = setup([
      org('jpice', 'SBO', [project(), project()]),
      org('psme', 'SBO', [project()]),
    ]);
    disqualified.push('jpice');
    const boards = await service.compute(SEMESTER);
    expect(boards.SBO.map((r) => [r.organizationId, r.rank])).toEqual([['psme', 1]]);
  });
});

describe('standingFactsOf', () => {
  it('keeps only tasks whose file is still filed', () => {
    const facts = standingFactsOf(
      org('jpice', 'SBO', [
        project(ON_TIME, 1, verifiedDoc({ deletedAt: new Date() })),
        project(ON_TIME, 1, verifiedDoc({ status: 'quarantined' })),
        project(ON_TIME, 1, verifiedDoc({ status: 'archived' })),
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

  it('marks submitted tasks that do not count for ranking (spec section 6)', () => {
    const unverifiedOf = (doc: Doc) =>
      standingFactsOf(org('a', 'SBO', [project(ON_TIME, 1, doc)])).projects[0]!.unverified;
    expect(unverifiedOf(clean)).toEqual([]);
    expect(unverifiedOf(verifiedDoc({ visibility: 'public' }))).toEqual([]);
    expect(unverifiedOf(verifiedDoc({ visibility: 'private' }))).toEqual(['ACR']);
    expect(unverifiedOf(verifiedDoc({ integrity: { legacy: true } }))).toEqual(['ACR']);
    expect(
      unverifiedOf(verifiedDoc({ integrity: { flaggedAt: NOW, flagReason: 'Forged' } })),
    ).toEqual(['ACR']);
    const warned = verifiedDoc({
      checks: [{ kind: 'keywords', result: 'warn', message: 'Missing: TAG' }],
    });
    expect(unverifiedOf(warned)).toEqual(['ACR']);
    expect(
      unverifiedOf({
        ...warned,
        currentVersion: {
          ...warned.currentVersion!,
          integrity: { ...warned.currentVersion!.integrity!, warningsClearedAt: NOW },
        },
      }),
    ).toEqual([]);
  });

  it('times a replacement of a flagged file from its own check, a legacy one from the first', () => {
    const recheckedAt = new Date('2026-11-20T02:00:00Z');
    const acrAt = (doc: Doc) =>
      standingFactsOf(org('a', 'SBO', [project(ON_TIME, 1, doc)])).projects[0]!.submitted.ACR;
    expect(
      acrAt(verifiedDoc({ integrity: { checkedAt: recheckedAt, replacesFlagged: true } })),
    ).toEqual(recheckedAt);
    expect(acrAt(verifiedDoc({ integrity: { checkedAt: recheckedAt } }))).toEqual(ON_TIME);
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

  it('snapshots and publishes nothing for a semester that never ranked anyone', async () => {
    const { service, snapshots, events } = setup([org('jpice', 'SBO', [])]);
    await service.compute(SEMESTER);
    expect(snapshots).toEqual([]);
    expect(events.published).toEqual([]);
  });

  it('publishes the semester when its standings change, once per recompute', async () => {
    const { service, events } = setup([
      org('jpice', 'SBO', [project()]),
      org('csc-cea', 'CSC', [project()]),
    ]);
    await service.compute(SEMESTER);
    expect(events.published).toEqual([SEMESTER]);
  });

  it('publishes nothing when a recompute changes nothing', async () => {
    const records = [org('jpice', 'SBO', [project()])];
    const { service, events } = setup(records);
    await service.compute(SEMESTER);
    await service.compute(SEMESTER);
    expect(events.published).toHaveLength(1);
  });

  it('publishes when a board empties (its last organization dropped out)', async () => {
    const records = [org('jpice', 'SBO', [project()])];
    const { service, events } = setup(records);
    await service.compute(SEMESTER);
    records[0]!.projects = [];
    const { SBO } = await service.compute(SEMESTER);
    expect(SBO).toEqual([]);
    expect(events.published).toHaveLength(2);
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

  it('shares one computation between reads that miss at the same time', async () => {
    const { service, leaderboard, store } = setup([org('jpice', 'SBO', [project()])]);
    store.read = () => Promise.resolve(null); // Redis gone: every read misses.
    const [sbo, csc] = await Promise.all([
      service.board(SEMESTER, 'SBO'),
      service.board(SEMESTER, 'CSC'),
    ]);
    expect(sbo).toHaveLength(1);
    expect(csc).toEqual([]);
    expect(leaderboard.standingFacts).toHaveBeenCalledOnce();
    // Once it is done, a later miss computes again.
    await service.board(SEMESTER, 'SBO');
    expect(leaderboard.standingFacts).toHaveBeenCalledTimes(2);
  });
});
