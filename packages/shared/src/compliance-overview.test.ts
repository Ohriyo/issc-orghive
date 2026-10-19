import { describe, expect, it } from 'vitest';
import { paragraphsOf, updateAnnouncementRequestSchema } from './announcement';
import {
  compareMostOverdue,
  complianceOverviewQuerySchema,
  type ComplianceRow,
} from './compliance-overview';
import { toCsv } from './csv';

function row(acronym: string, overdueDays: number[]): ComplianceRow {
  return {
    organization: {
      type: 'SBO',
      slug: acronym.toLowerCase(),
      acronym,
      name: acronym,
      college: 'CEA',
    },
    activeProjects: 1,
    blockedProjects: [],
    nextDeadline: null,
    overdueTasks: overdueDays.map((daysOverdue) => ({
      projectId: '0195f3c0-0000-7000-8000-0000000000c1',
      projectName: 'P',
      task: 'ACR',
      dueAt: '2026-10-01T15:59:59.999Z',
      daysOverdue,
    })),
    frozenSince: null,
    openAppeals: 0,
  };
}

describe('compareMostOverdue', () => {
  it('puts the oldest overdue task first, then more overdue tasks, then the name', () => {
    const rows = [
      row('PSME', []),
      row('JPICE', [3, 1, 1]),
      row('IECEP', [9]),
      row('UAPSA', [3]),
      row('ICPEP', []),
    ];
    expect(rows.sort(compareMostOverdue).map((r) => r.organization.acronym)).toEqual([
      'IECEP',
      'JPICE',
      'UAPSA',
      'ICPEP',
      'PSME',
    ]);
  });
});

describe('complianceOverviewQuerySchema', () => {
  it('takes both academic year and semester, or neither', () => {
    expect(complianceOverviewQuerySchema.safeParse({}).success).toBe(true);
    expect(
      complianceOverviewQuerySchema.safeParse({ academicYear: '2026-2027', semester: 'first' })
        .success,
    ).toBe(true);
    expect(complianceOverviewQuerySchema.safeParse({ semester: 'first' }).success).toBe(false);
  });
});

describe('toCsv', () => {
  it('quotes commas, quotes and newlines, with CRLF line ends', () => {
    expect(
      toCsv([
        ['a', 'b,c'],
        ['say "hi"', 'two\nlines'],
        [3, null],
      ]),
    ).toBe('a,"b,c"\r\n"say ""hi""","two\nlines"\r\n3,\r\n');
  });

  it('defuses cells a spreadsheet would run as formulas', () => {
    expect(toCsv([['=HYPERLINK("x")', '+1', '-2', '@SUM(A1)', 'safe']])).toBe(
      `"'=HYPERLINK(""x"")",'+1,'-2,'@SUM(A1),safe\r\n`,
    );
    // Numbers stay numbers, negative ones included.
    expect(toCsv([[-3]])).toBe('-3\r\n');
  });
});

describe('announcements', () => {
  it('splits a plain-text body into paragraphs on blank lines', () => {
    expect(paragraphsOf('First line\nstill first\r\n\r\n\n  Second  \n\n')).toEqual([
      'First line\nstill first',
      'Second',
    ]);
  });

  it('needs a change to update', () => {
    expect(updateAnnouncementRequestSchema.safeParse({}).success).toBe(false);
    expect(updateAnnouncementRequestSchema.safeParse({ title: 'New title' }).success).toBe(true);
  });
});
