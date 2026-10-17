import { describe, expect, it } from 'vitest';
import {
  academicYearOf,
  addDays,
  daysBetween,
  deadlineAfter,
  endOfManilaDay,
  manilaDate,
} from './manila-time';

describe('Manila calendar days', () => {
  it('uses the Manila date, not the UTC one', () => {
    // 2026-10-01 17:00 UTC is already 2026-10-02 01:00 in Manila.
    expect(manilaDate(new Date('2026-10-01T17:00:00Z'))).toBe('2026-10-02');
    expect(manilaDate(new Date('2026-10-01T15:59:59Z'))).toBe('2026-10-01');
  });

  it('adds calendar days across months and years', () => {
    expect(addDays('2026-10-25', 14)).toBe('2026-11-08');
    expect(addDays('2026-12-25', 14)).toBe('2027-01-08');
    expect(daysBetween('2026-10-16', '2026-10-30')).toBe(14);
    expect(daysBetween('2026-10-16', '2026-10-15')).toBe(-1);
  });

  it('ends a day at 23:59:59 Manila time', () => {
    expect(endOfManilaDay('2026-10-15').toISOString()).toBe('2026-10-15T15:59:59.999Z');
  });

  it('puts the deadline at the end of day 14, counting the start as day 0', () => {
    // Created Oct 1, 10:00 Manila: due Oct 15, 23:59:59 Manila.
    expect(deadlineAfter(new Date('2026-10-01T02:00:00Z')).toISOString()).toBe(
      '2026-10-15T15:59:59.999Z',
    );
    // Created Oct 1, 23:30 Manila (still Oct 1 there, Oct 1 15:30 UTC).
    expect(deadlineAfter(new Date('2026-10-01T15:30:00Z')).toISOString()).toBe(
      '2026-10-15T15:59:59.999Z',
    );
    // An event on Oct 20: reports due Nov 3.
    expect(deadlineAfter('2026-10-20').toISOString()).toBe('2026-11-03T15:59:59.999Z');
  });

  it('starts the academic year in August', () => {
    expect(academicYearOf('2026-08-01')).toBe('2026-2027');
    expect(academicYearOf('2027-07-31')).toBe('2026-2027');
    expect(academicYearOf('2026-03-10')).toBe('2025-2026');
  });
});
