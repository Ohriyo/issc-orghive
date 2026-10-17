import { describe, expect, it } from 'vitest';
import { generateReportRequestSchema, semesterOf, semesterRange } from './report';

describe('semesters (fixed ranges, academic year from August)', () => {
  it('places a date in its semester', () => {
    expect(semesterOf('2026-08-01')).toBe('first');
    expect(semesterOf('2026-12-31')).toBe('first');
    expect(semesterOf('2027-01-01')).toBe('second');
    expect(semesterOf('2027-05-31')).toBe('second');
    expect(semesterOf('2027-06-01')).toBe('midyear');
    expect(semesterOf('2027-07-31')).toBe('midyear');
  });

  it('gives each semester’s dates within its academic year', () => {
    expect(semesterRange('2026-2027', 'first')).toEqual({ start: '2026-08-01', end: '2026-12-31' });
    expect(semesterRange('2026-2027', 'second')).toEqual({
      start: '2027-01-01',
      end: '2027-05-31',
    });
    expect(semesterRange('2026-2027', 'midyear')).toEqual({
      start: '2027-06-01',
      end: '2027-07-31',
    });
  });

  it('validates the request', () => {
    expect(
      generateReportRequestSchema.safeParse({ academicYear: '2026-2027', semester: 'first' })
        .success,
    ).toBe(true);
    expect(
      generateReportRequestSchema.safeParse({ academicYear: '2026-2028', semester: 'first' })
        .success,
    ).toBe(false);
    expect(
      generateReportRequestSchema.safeParse({ academicYear: '2026-2027', semester: 'summer' })
        .success,
    ).toBe(false);
  });
});
