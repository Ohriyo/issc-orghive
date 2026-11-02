import { describe, expect, it } from 'vitest';
import {
  nextSemesterKey,
  provisionalUntil,
  semesterCalendar,
  semesterDatesProblem,
  semesterKeysOfYears,
  setSemesterDatesRequestSchema,
  USUAL_SEMESTERS,
} from './semester-calendar';

const FIRST = { academicYear: '2026-2027', semester: 'first' as const };
const SECOND = { academicYear: '2026-2027', semester: 'second' as const };
const MIDYEAR = { academicYear: '2026-2027', semester: 'midyear' as const };
const MIDYEAR_BEFORE = { academicYear: '2025-2026', semester: 'midyear' as const };

describe('nextSemesterKey', () => {
  it('goes 1st → 2nd → midyear → the next year’s 1st', () => {
    expect(nextSemesterKey(FIRST)).toEqual(SECOND);
    expect(nextSemesterKey(SECOND)).toEqual(MIDYEAR);
    expect(nextSemesterKey(MIDYEAR)).toEqual({ academicYear: '2027-2028', semester: 'first' });
  });
});

describe('the usual calendar', () => {
  it('keeps every semester’s usual dates, with no gaps', () => {
    expect(USUAL_SEMESTERS.rangeOf(FIRST)).toEqual({ start: '2026-08-01', end: '2026-12-31' });
    expect(USUAL_SEMESTERS.spanOf(FIRST)).toEqual({ start: '2026-08-01', end: '2026-12-31' });
    expect(USUAL_SEMESTERS.spanOf(SECOND)).toEqual({ start: '2027-01-01', end: '2027-05-31' });
    expect(USUAL_SEMESTERS.isSet(FIRST)).toBe(false);
  });

  it('puts a date in the semester that contains it', () => {
    expect(USUAL_SEMESTERS.keyOf('2026-08-01')).toEqual(FIRST);
    expect(USUAL_SEMESTERS.keyOf('2026-12-31')).toEqual(FIRST);
    expect(USUAL_SEMESTERS.keyOf('2027-01-01')).toEqual(SECOND);
    expect(USUAL_SEMESTERS.keyOf('2027-06-01')).toEqual(MIDYEAR);
    expect(USUAL_SEMESTERS.keyOf('2026-07-31')).toEqual(MIDYEAR_BEFORE);
  });

  it('reads today in Manila', () => {
    // 17:00 UTC on Jul 31 is already Aug 1 in Manila.
    expect(USUAL_SEMESTERS.currentKey(new Date('2026-07-31T17:00:00Z'))).toEqual(FIRST);
  });
});

describe('a calendar with the ISSC’s dates', () => {
  const calendar = semesterCalendar([
    { ...FIRST, start: '2026-08-17', end: '2026-12-18' },
    { ...SECOND, start: '2027-01-11', end: '2027-06-04' },
  ]);

  it('tells people the dates that were set', () => {
    expect(calendar.rangeOf(FIRST)).toEqual({ start: '2026-08-17', end: '2026-12-18' });
    expect(calendar.isSet(FIRST)).toBe(true);
    expect(calendar.isSet(MIDYEAR)).toBe(false);
  });

  it('puts a date inside a semester in it', () => {
    expect(calendar.keyOf('2026-12-18')).toEqual(FIRST);
    expect(calendar.keyOf('2027-01-11')).toEqual(SECOND);
  });

  it('puts a date in a break in the semester after it', () => {
    expect(calendar.keyOf('2026-12-19')).toEqual(SECOND);
    expect(calendar.keyOf('2027-01-05')).toEqual(SECOND);
    expect(calendar.keyOf('2026-08-05')).toEqual(FIRST);
  });

  it('stretches a semester past its usual end, and the next one starts after it', () => {
    expect(calendar.keyOf('2027-06-03')).toEqual(SECOND);
    expect(calendar.keyOf('2027-06-05')).toEqual(MIDYEAR);
    expect(calendar.spanOf(MIDYEAR)).toEqual({ start: '2027-06-05', end: '2027-07-31' });
  });

  it('spans every date that belongs to the semester, breaks included', () => {
    expect(calendar.spanOf(FIRST)).toEqual({ start: '2026-08-01', end: '2026-12-18' });
    expect(calendar.spanOf(SECOND)).toEqual({ start: '2026-12-19', end: '2027-06-04' });
  });

  it('never leaves a date out or counts it twice', () => {
    for (const iso of ['2026-08-01', '2026-12-18', '2026-12-19', '2027-06-04', '2027-06-05']) {
      const key = calendar.keyOf(iso);
      const span = calendar.spanOf(key);
      expect(iso >= span.start && iso <= span.end).toBe(true);
    }
  });
});

describe('semesterDatesProblem', () => {
  const none = USUAL_SEMESTERS;
  it('accepts a late start and an early or late end', () => {
    expect(semesterDatesProblem(none, { ...FIRST, start: '2026-08-17', end: '2026-12-18' })).toBe(
      null,
    );
    expect(semesterDatesProblem(none, { ...FIRST, start: '2026-07-20', end: '2027-01-15' })).toBe(
      null,
    );
  });

  it('refuses a last day on or before the first', () => {
    expect(semesterDatesProblem(none, { ...FIRST, start: '2026-08-17', end: '2026-08-17' })).toMatch(
      /after the first day/,
    );
  });

  it('refuses dates of the wrong year', () => {
    expect(semesterDatesProblem(none, { ...FIRST, start: '2027-08-17', end: '2027-12-18' })).toMatch(
      /Check the year/,
    );
    expect(semesterDatesProblem(none, { ...FIRST, start: '2025-08-17', end: '2025-12-18' })).toMatch(
      /Check the year/,
    );
  });

  it('refuses a last day that swallows the next semester', () => {
    expect(semesterDatesProblem(none, { ...FIRST, start: '2026-08-17', end: '2027-06-01' })).toMatch(
      /Check the year/,
    );
  });

  it('refuses an overlap with another semester’s set dates, but not with its own', () => {
    const calendar = semesterCalendar([{ ...SECOND, start: '2027-01-11', end: '2027-05-28' }]);
    expect(
      semesterDatesProblem(calendar, { ...FIRST, start: '2026-08-17', end: '2027-01-15' }),
    ).toMatch(/overlap/);
    expect(
      semesterDatesProblem(calendar, { ...SECOND, start: '2027-01-12', end: '2027-05-29' }),
    ).toBe(null);
  });
});

describe('provisionalUntil', () => {
  it('is the last day plus the grace days, across a month', () => {
    expect(provisionalUntil('2026-12-31', 7)).toBe('2027-01-07');
    expect(provisionalUntil('2026-12-31', 0)).toBe('2026-12-31');
  });
});

describe('semesterKeysOfYears', () => {
  it('lists this academic year and the next, in order', () => {
    const keys = semesterKeysOfYears('2026-2027');
    expect(keys).toHaveLength(6);
    expect(keys[0]).toEqual(FIRST);
    expect(keys[3]).toEqual({ academicYear: '2027-2028', semester: 'first' });
  });
});

describe('setSemesterDatesRequestSchema', () => {
  it('needs both dates in order and who is acting', () => {
    const ok = { start: '2026-08-17', end: '2026-12-18', actingAs: 'Ana Reyes' };
    expect(setSemesterDatesRequestSchema.safeParse(ok).success).toBe(true);
    expect(setSemesterDatesRequestSchema.safeParse({ ...ok, end: '2026-08-01' }).success).toBe(
      false,
    );
    expect(setSemesterDatesRequestSchema.safeParse({ ...ok, actingAs: '' }).success).toBe(false);
    expect(setSemesterDatesRequestSchema.safeParse({ ...ok, start: 'soon' }).success).toBe(false);
  });
});
