import { z } from 'zod';
import { academicYearSchema, SEMESTERS, semesterSchema } from './academic-term';
import { actingAsSchema } from './acting-as';
import {
  previousSemesterKey,
  semesterKeyOf,
  standingsStatusSchema,
  type SemesterKey,
} from './leaderboard';
import { addDays, manilaDate } from './manila-time';
import { semesterRange } from './report';

/*
 * The semester calendar (spec 5B): the university's calendar varies, so the ISSC account sets
 * each semester's first and last day at /admin/semesters. A semester it has not set keeps its
 * usual dates (semesterRange in report.ts).
 */

const isoDateSchema = z.iso.date('Pick a date');

export const semesterDatesSchema = z
  .object({
    academicYear: academicYearSchema,
    semester: semesterSchema,
    start: isoDateSchema,
    end: isoDateSchema,
  })
  .meta({ id: 'SemesterDates' });
export type SemesterDates = z.infer<typeof semesterDatesSchema>;

/** GET /semesters: the dates the ISSC set; every other semester keeps its usual dates. */
export const semesterCalendarResponseSchema = z
  .object({ semesters: z.array(semesterDatesSchema) })
  .meta({ id: 'SemesterCalendarResponse' });
export type SemesterCalendarResponse = z.infer<typeof semesterCalendarResponseSchema>;

export interface DateRange {
  start: string;
  end: string;
}

/** The semester after this one: 1st → 2nd → midyear → the next year's 1st. */
export function nextSemesterKey({ academicYear, semester }: SemesterKey): SemesterKey {
  const at = SEMESTERS.indexOf(semester);
  const next = SEMESTERS[at + 1];
  if (next) return { academicYear, semester: next };
  const start = Number(academicYear.slice(0, 4)) + 1;
  return { academicYear: `${start}-${start + 1}`, semester: SEMESTERS[0] };
}

const sameSemester = (a: SemesterKey, b: SemesterKey) =>
  a.academicYear === b.academicYear && a.semester === b.semester;

/** A semester's dates and which semester a date belongs to, with the ISSC's dates applied. */
export interface SemesterCalendar {
  /** The dates the ISSC set. */
  dates: readonly SemesterDates[];
  isSet(key: SemesterKey): boolean;
  /** The semester's first and last day: what people are told. */
  rangeOf(key: SemesterKey): DateRange;
  /**
   * Every date that belongs to the semester: from the day after the previous semester's last
   * day, through its own. Without dates set, the same as `rangeOf`.
   */
  spanOf(key: SemesterKey): DateRange;
  /** The semester a date belongs to. A date in a break belongs to the semester after it. */
  keyOf(isoDate: string): SemesterKey;
  /** The semester of today in Manila. */
  currentKey(at: Date): SemesterKey;
}

/**
 * Builds the calendar from the ISSC's dates. Only ends decide what belongs where, and
 * `semesterDatesProblem` keeps them in order, so a date's semester is always the first one not
 * yet over: that is the previous one, the usual one or the next one.
 */
export function semesterCalendar(dates: readonly SemesterDates[]): SemesterCalendar {
  const setDates = (key: SemesterKey) => dates.find((d) => sameSemester(d, key));
  const rangeOf = (key: SemesterKey): DateRange => {
    const set = setDates(key);
    return set
      ? { start: set.start, end: set.end }
      : semesterRange(key.academicYear, key.semester);
  };
  const keyOf = (isoDate: string): SemesterKey => {
    const usual = semesterKeyOf(isoDate);
    const candidates = [previousSemesterKey(usual), usual];
    return candidates.find((key) => rangeOf(key).end >= isoDate) ?? nextSemesterKey(usual);
  };
  return {
    dates,
    isSet: (key) => setDates(key) !== undefined,
    rangeOf,
    spanOf: (key) => ({
      start: addDays(rangeOf(previousSemesterKey(key)).end, 1),
      end: rangeOf(key).end,
    }),
    keyOf,
    currentKey: (at) => keyOf(manilaDate(at)),
  };
}

/** The calendar with no dates set: every semester keeps its usual dates. */
export const USUAL_SEMESTERS = semesterCalendar([]);

/**
 * Why these dates cannot be saved, or null. A semester stays in its place among the others: it
 * ends after the previous semester's usual end and before the next one's, and starts after the
 * previous one's usual start. It may not overlap dates the ISSC set for another semester.
 */
export function semesterDatesProblem(
  calendar: SemesterCalendar,
  { academicYear, semester, start, end }: SemesterDates,
): string | null {
  if (end <= start) return 'The last day must be after the first day.';
  const key = { academicYear, semester };
  const usualPrevious = USUAL_SEMESTERS.rangeOf(previousSemesterKey(key));
  const usualNext = USUAL_SEMESTERS.rangeOf(nextSemesterKey(key));
  if (start <= usualPrevious.start || end <= usualPrevious.end || end >= usualNext.end) {
    return 'These dates are too far from this semester’s place in the academic year. Check the year.';
  }
  const overlapping = calendar.dates.find(
    (other) => !sameSemester(other, key) && other.start <= end && start <= other.end,
  );
  return overlapping ? 'These dates overlap another semester’s dates.' : null;
}

/** Until when a semester's standings stay provisional: its last day plus the grace days. */
export function provisionalUntil(end: string, finalAfterDays: number): string {
  return addDays(end, finalAfterDays);
}

/** PUT /admin/semesters/:academicYear/:semester. */
export const semesterParamsSchema = z.strictObject({
  academicYear: academicYearSchema,
  semester: semesterSchema,
});

export const setSemesterDatesRequestSchema = z
  .strictObject({ start: isoDateSchema, end: isoDateSchema, actingAs: actingAsSchema })
  .refine(({ start, end }) => end > start, {
    path: ['end'],
    error: 'The last day must be after the first day.',
  });
export type SetSemesterDatesRequest = z.infer<typeof setSemesterDatesRequestSchema>;

/** One row of /admin/semesters. */
export const adminSemesterSchema = z.object({
  academicYear: academicYearSchema,
  semester: semesterSchema,
  start: isoDateSchema,
  end: isoDateSchema,
  /** False while the semester keeps its usual dates. */
  isSet: z.boolean(),
  /** A final semester's dates can no longer change. */
  status: standingsStatusSchema,
  provisionalUntil: isoDateSchema,
});
export type AdminSemester = z.infer<typeof adminSemesterSchema>;

/** GET /admin/semesters: this academic year and the next, in calendar order. */
export const adminSemestersResponseSchema = z
  .object({
    /** Days after a semester's last day until its standings are final (spec 5B). */
    finalAfterDays: z.number().int().nonnegative(),
    semesters: z.array(adminSemesterSchema),
  })
  .meta({ id: 'AdminSemestersResponse' });
export type AdminSemestersResponse = z.infer<typeof adminSemestersResponseSchema>;

/** The academic years /admin/semesters lists. */
export function semesterKeysOfYears(firstYear: string, years = 2): SemesterKey[] {
  const start = Number(firstYear.slice(0, 4));
  return Array.from({ length: years }, (_, i) => `${start + i}-${start + i + 1}`).flatMap(
    (academicYear) => SEMESTERS.map((semester) => ({ academicYear, semester })),
  );
}
