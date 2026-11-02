import { beforeEach, describe, expect, it, vi } from 'vitest';
import { semesterCalendar, type SemesterDates } from '@orghive/shared';
import { memoryCache } from '#src/lib/cache';
import {
  createSemesterCalendarService,
  createSemesterReader,
  USUAL_SEMESTER_READER,
} from '#src/services/semester-calendar.service';

const FIRST = { academicYear: '2026-2027', semester: 'first' as const };
const SECOND = { academicYear: '2026-2027', semester: 'second' as const };
const CTX = { ip: '127.0.0.1', userAgent: 'test' };
const INPUT = { start: '2026-08-17', end: '2026-12-18', actingAs: 'Ana Reyes' };

function setup({ set = [] as SemesterDates[], status = 'provisional', days = 7 } = {}) {
  const dates = {
    save: vi.fn(() => Promise.resolve()),
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
  const cache = { deleteMatching: vi.fn(() => Promise.resolve()) };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  const service = createSemesterCalendarService({
    dates,
    semesters: { load: () => Promise.resolve(semesterCalendar(set)) },
    leaderboard,
    settings: { finalAfterDays: () => Promise.resolve(days) },
    recompute,
    cache,
    audit,
    now: () => new Date('2026-11-02T04:00:00Z'),
  });
  return { service, dates, leaderboard, recompute, cache, audit };
}

describe('createSemesterReader', () => {
  it('reads the dates once, until the entry is deleted', async () => {
    const dates = { all: vi.fn(() => Promise.resolve([{ ...FIRST, ...INPUT }])) };
    const cache = memoryCache();
    const reader = createSemesterReader({ dates, cache });
    expect((await reader.load()).isSet(FIRST)).toBe(true);
    await reader.load();
    expect(dates.all).toHaveBeenCalledOnce();
    await cache.deleteMatching('semester:calendar');
    await reader.load();
    expect(dates.all).toHaveBeenCalledTimes(2);
  });

  it('falls back to the usual dates when the cache gives nothing', async () => {
    const reader = createSemesterReader({
      dates: { all: () => Promise.resolve([]) },
      cache: { getOrSet: () => Promise.resolve(null) },
    });
    expect((await reader.load()).rangeOf(FIRST).end).toBe('2026-12-31');
  });
});

describe('USUAL_SEMESTER_READER', () => {
  it('has no dates set', async () => {
    expect((await USUAL_SEMESTER_READER.load()).dates).toEqual([]);
  });
});

describe('semesterCalendar.read', () => {
  it('gives only the dates the ISSC set', async () => {
    const set = [{ ...FIRST, start: '2026-08-17', end: '2026-12-18' }];
    await expect(setup({ set }).service.read()).resolves.toEqual({ semesters: set });
  });
});

describe('semesterCalendar.adminList', () => {
  it('lists this academic year and the next, set or usual, with their status', async () => {
    const set = [{ ...FIRST, start: '2026-08-17', end: '2026-12-18' }];
    const res = await setup({ set }).service.adminList();
    expect(res.finalAfterDays).toBe(7);
    expect(res.semesters).toHaveLength(6);
    expect(res.semesters[0]).toEqual({
      ...FIRST,
      start: '2026-08-17',
      end: '2026-12-18',
      isSet: true,
      status: 'provisional',
      provisionalUntil: '2026-12-25',
    });
    expect(res.semesters[1]).toMatchObject({
      ...SECOND,
      start: '2027-01-01',
      end: '2027-05-31',
      isSet: false,
    });
  });
});

describe('semesterCalendar.set', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('saves, audits with acting-as, clears the cache, recomputes this and the next semester', async () => {
    await ctx.service.set('u1', FIRST, INPUT, CTX);
    expect(ctx.dates.save).toHaveBeenCalledWith(FIRST, INPUT, 'u1');
    expect(ctx.cache.deleteMatching).toHaveBeenCalledWith('semester:calendar');
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'semester_dates_change',
        actorId: 'u1',
        entityId: '2026-2027:first',
        actingAs: 'Ana Reyes',
        metadata: {
          before: { start: '2026-08-01', end: '2026-12-31' },
          after: { start: '2026-08-17', end: '2026-12-18' },
        },
      }),
    );
    expect(ctx.recompute.forSemesters).toHaveBeenCalledWith(FIRST, SECOND);
  });

  it('409s once the standings are final', async () => {
    const { service, dates } = setup({ status: 'final' });
    await expect(service.set('u1', FIRST, INPUT, CTX)).rejects.toMatchObject({ status: 409 });
    expect(dates.save).not.toHaveBeenCalled();
  });

  it('409s dates out of place', async () => {
    await expect(
      ctx.service.set('u1', FIRST, { ...INPUT, start: '2027-08-17', end: '2027-12-18' }, CTX),
    ).rejects.toMatchObject({ status: 409 });
    expect(ctx.dates.save).not.toHaveBeenCalled();
  });

  it('409s a last day that would make the standings final at once', async () => {
    // Today is Nov 2; Oct 25 plus 7 days has passed.
    await expect(
      ctx.service.set('u1', FIRST, { ...INPUT, end: '2026-10-25' }, CTX),
    ).rejects.toThrow(/final at once/);
    expect(ctx.dates.save).not.toHaveBeenCalled();
  });

  it('allows a last day already past while its grace days run', async () => {
    await ctx.service.set('u1', FIRST, { ...INPUT, end: '2026-10-28' }, CTX);
    expect(ctx.dates.save).toHaveBeenCalledOnce();
  });
});
