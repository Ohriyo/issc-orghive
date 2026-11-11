import { describe, expect, it } from 'vitest';
import { semesterCalendar, USUAL_SEMESTERS, type ShowcaseProject } from '@orghive/shared';
import {
  badgeSemester,
  boardOf,
  groupBySemester,
  rankBadge,
} from '#src/services/org-showcase-rules';

const project = (id: string, date: string, title = id): ShowcaseProject => ({
  id,
  title,
  date,
  location: 'CEA',
  beneficiaries: 'Students',
  files: [],
});

describe('badgeSemester', () => {
  const first = USUAL_SEMESTERS.rangeOf({ academicYear: '2026-2027', semester: 'first' });

  it('is the current semester while it runs', () => {
    expect(badgeSemester(USUAL_SEMESTERS, new Date(`${first.start}T04:00:00Z`))).toEqual({
      academicYear: '2026-2027',
      semester: 'first',
    });
  });

  it('keeps the semester that ended until the next one starts', () => {
    // Dates the ISSC set leave a break between the 1st semester and the 2nd.
    const calendar = semesterCalendar([
      { academicYear: '2026-2027', semester: 'first', start: '2026-08-10', end: '2026-12-15' },
      { academicYear: '2026-2027', semester: 'second', start: '2027-01-11', end: '2027-05-28' },
    ]);
    const inBreak = new Date('2026-12-28T04:00:00Z');
    expect(calendar.currentKey(inBreak)).toEqual({ academicYear: '2026-2027', semester: 'second' });
    expect(badgeSemester(calendar, inBreak)).toEqual({
      academicYear: '2026-2027',
      semester: 'first',
    });
    expect(badgeSemester(calendar, new Date('2027-01-11T04:00:00Z'))).toEqual({
      academicYear: '2026-2027',
      semester: 'second',
    });
  });
});

describe('rankBadge', () => {
  const base = {
    organizationId: 'jpice',
    organizationType: 'SBO' as const,
    semester: { academicYear: '2026-2027', semester: 'first' as const },
    status: 'provisional' as const,
    rows: [
      { organizationId: 'psme', rank: 1 },
      { organizationId: 'jpice', rank: 3 },
      { organizationId: 'eleventh', rank: 11 },
    ],
  };

  it('gives a top-10 organization its place on its own board', () => {
    expect(rankBadge(base)).toEqual({
      board: 'SBO',
      rank: 3,
      academicYear: '2026-2027',
      semester: 'first',
      status: 'provisional',
    });
    expect(rankBadge({ ...base, organizationType: 'CSC', status: 'final' })).toMatchObject({
      board: 'CSC',
      status: 'final',
    });
  });

  it('gives nothing below 10th, when unranked, or to the ISSC', () => {
    expect(rankBadge({ ...base, organizationId: 'eleventh' })).toBeNull();
    expect(rankBadge({ ...base, organizationId: 'nobody' })).toBeNull();
    expect(rankBadge({ ...base, organizationType: 'ISSC' })).toBeNull();
    expect(boardOf('ISSC')).toBeNull();
    expect(boardOf('SBO')).toBe('SBO');
  });
});

describe('groupBySemester', () => {
  it('groups newest first by the semester the calendar puts each event in', () => {
    const groups = groupBySemester(
      [
        project('old', '2026-03-02'),
        project('b', '2026-09-15', 'Barangay survey'),
        project('a', '2026-09-15', 'CE Week'),
        project('aug', '2026-08-23'),
      ],
      USUAL_SEMESTERS,
    );
    expect(groups.map((g) => [g.academicYear, g.semester, g.projects.map((p) => p.id)])).toEqual([
      ['2026-2027', 'first', ['b', 'a', 'aug']],
      ['2025-2026', 'second', ['old']],
    ]);
  });

  it('returns no groups without projects', () => {
    expect(groupBySemester([], USUAL_SEMESTERS)).toEqual([]);
  });
});
