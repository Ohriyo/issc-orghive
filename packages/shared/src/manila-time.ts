/**
 * Deadlines are counted in Asia/Manila calendar days (docs/DOMAIN_RULES.md). Manila is
 * UTC+8 all year, with no daylight saving, so a fixed offset is exact.
 */
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Project deadlines: 14 calendar days (docs/PROJECT_WORKFLOW_SPEC.md, section 2B). */
export const DEADLINE_DAYS = 14;

/** The Manila calendar date of an instant, `YYYY-MM-DD`. */
export function manilaDate(at: Date): string {
  return new Date(at.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` plus `days` calendar days. */
export function addDays(isoDate: string, days: number): string {
  const day = new Date(`${isoDate}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** The last instant of a Manila calendar day: 23:59:59.999 at UTC+8. */
export function endOfManilaDay(isoDate: string): Date {
  return new Date(`${isoDate}T23:59:59.999+08:00`);
}

/** Whole calendar days from one `YYYY-MM-DD` to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (24 * 60 * 60 * 1000),
  );
}

/**
 * The deadline `DEADLINE_DAYS` after a Manila day: 23:59:59 Manila time on day 14, where
 * day 0 is `from` (an instant, such as a project's creation, or a `YYYY-MM-DD` date).
 */
export function deadlineAfter(from: Date | string, days = DEADLINE_DAYS): Date {
  const start = typeof from === 'string' ? from : manilaDate(from);
  return endOfManilaDay(addDays(start, days));
}

/** The academic year a date falls in: it starts in August ("2026-2027"). */
export function academicYearOf(isoDate: string): string {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const start = month >= 8 ? year : year - 1;
  return `${start}-${start + 1}`;
}
