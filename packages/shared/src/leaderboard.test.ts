import { describe, expect, it } from 'vitest';
import {
  correctFinancialFiguresRequestSchema,
  currentSemesterKey,
  financialFiguresFormSchema,
  formatPesos,
  latePointsSchema,
  leaderboardQuerySchema,
  leaderboardStreamQuerySchema,
  MAX_FIGURE_CENTAVOS,
  parsePesos,
  pesosInputValue,
  pointsBreakdown,
  previousSemesterKey,
  publicLeaderboardRowSchema,
  semesterKeyOf,
  underReviewNote,
  updateSystemSettingsRequestSchema,
} from './leaderboard';
import { taskDocumentRequestSchemaFor } from './project';

const UPLOAD_KEY =
  'uploads/0193b3a8-0f2c-7cc4-b3b1-5c1f6a1b2c3d/0193b3a8-0f2c-7cc4-b3b1-5c1f6a1b2c3e';

describe('parsePesos', () => {
  it.each([
    ['12,345.50', 1_234_550],
    ['12345.5', 1_234_550],
    ['₱ 800', 80_000],
    ['₱1,000,000', 100_000_000],
    ['0', 0],
    ['0.05', 5],
    ['  42.10 ', 4_210],
  ])('reads %s as %d centavos', (text, centavos) => {
    expect(parsePesos(text)).toBe(centavos);
  });

  it.each(['', 'abc', '-5', '1.234', '12,34', '1,2345', '1e3', '.5', '₱'])(
    'refuses %j',
    (text) => {
      expect(parsePesos(text)).toBeNull();
    },
  );
});

describe('formatPesos', () => {
  it.each([
    [1_234_500, '₱12,345.00'],
    [5, '₱0.05'],
    [0, '₱0.00'],
    [100_000_000, '₱1,000,000.00'],
    [-123_450, '−₱1,234.50'],
  ])('shows %d as %s', (centavos, text) => {
    expect(formatPesos(centavos)).toBe(text);
  });

  it('round-trips through the form value', () => {
    expect(pesosInputValue(1_234_505)).toBe('12345.05');
    expect(parsePesos(pesosInputValue(1_234_505))).toBe(1_234_505);
  });
});

describe('financialFiguresFormSchema', () => {
  it('parses both fields to centavos', () => {
    expect(financialFiguresFormSchema.parse({ income: '1,500.25', expenses: '300' })).toEqual({
      income: 150_025,
      expenses: 30_000,
    });
  });

  it('names the field that is wrong', () => {
    const result = financialFiguresFormSchema.safeParse({ income: '', expenses: 'lots' });
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((i) => [i.path[0], i.message]);
    expect(messages).toEqual([
      ['income', 'Enter the total income'],
      ['expenses', 'Enter the total expenses in pesos, e.g. 12,345.50'],
    ]);
  });

  it('caps each amount at ₱10,000,000.00', () => {
    expect(
      financialFiguresFormSchema.safeParse({ income: '10,000,000.01', expenses: '0' }).success,
    ).toBe(false);
    expect(
      financialFiguresFormSchema.safeParse({ income: '10,000,000.00', expenses: '0' }).success,
    ).toBe(true);
  });
});

describe('Financial Report requests', () => {
  const file = { uploadKey: UPLOAD_KEY, visibility: 'private', actingAs: 'Juan Dela Cruz' };
  const figures = { incomeCentavos: 100, expensesCentavos: 50 };

  it('requires the figures with a Financial Report file only', () => {
    const financial = taskDocumentRequestSchemaFor('FINANCIAL_REPORT');
    expect(financial.safeParse(file).success).toBe(false);
    expect(financial.safeParse({ ...file, figures }).success).toBe(true);
    expect(taskDocumentRequestSchemaFor('ACR').safeParse(file).success).toBe(true);
    expect(taskDocumentRequestSchemaFor('ACR').safeParse({ ...file, figures }).success).toBe(
      false,
    );
  });

  it('takes whole, non-negative centavos within the cap', () => {
    const parse = (incomeCentavos: number) =>
      correctFinancialFiguresRequestSchema.safeParse({
        incomeCentavos,
        expensesCentavos: 0,
        actingAs: 'Juan',
      }).success;
    expect(parse(0)).toBe(true);
    expect(parse(MAX_FIGURE_CENTAVOS)).toBe(true);
    expect(parse(MAX_FIGURE_CENTAVOS + 1)).toBe(false);
    expect(parse(-1)).toBe(false);
    expect(parse(10.5)).toBe(false);
  });

  it('requires who is acting on a correction', () => {
    expect(correctFinancialFiguresRequestSchema.safeParse(figures).success).toBe(false);
  });
});

describe('late points setting', () => {
  it.each([0, 0.5, 0.25, 1, 0.3])('accepts %d', (value) => {
    expect(latePointsSchema.safeParse(value).success).toBe(true);
  });

  it.each([-0.1, 1.5, 0.333])('refuses %d', (value) => {
    expect(latePointsSchema.safeParse(value).success).toBe(false);
  });

  it('needs at least one setting to change', () => {
    expect(updateSystemSettingsRequestSchema.safeParse({}).success).toBe(false);
    expect(
      updateSystemSettingsRequestSchema.safeParse({ leaderboardLatePoints: 0.25 }).success,
    ).toBe(true);
  });
});

describe('labels', () => {
  it.each([
    [4.5, 5, 1, '4.5 pts · 5 projects (1 late)'],
    [1, 1, 0, '1 pt · 1 project'],
    [0.5, 1, 1, '0.5 pts · 1 project (1 late)'],
    [2, 2, 0, '2 pts · 2 projects'],
  ])('%d points, %d projects, %d late', (points, implemented, late, text) => {
    expect(pointsBreakdown(points, implemented, late)).toBe(text);
  });

  it('notes reports under review', () => {
    expect(underReviewNote(0)).toBe('');
    expect(underReviewNote(1)).toBe('(1 report under review)');
    expect(underReviewNote(2)).toBe('(2 reports under review)');
  });
});

describe('semesters', () => {
  it.each([
    ['2026-08-01', '2026-2027', 'first'],
    ['2026-12-28', '2026-2027', 'first'],
    ['2027-01-05', '2026-2027', 'second'],
    ['2027-06-15', '2026-2027', 'midyear'],
    ['2027-07-31', '2026-2027', 'midyear'],
  ])('%s is in %s %s', (date, academicYear, semester) => {
    expect(semesterKeyOf(date)).toEqual({ academicYear, semester });
  });

  it('takes the current semester in Manila time', () => {
    // 16:30 UTC on Jul 31 is already Aug 1 in Manila.
    expect(currentSemesterKey(new Date('2026-07-31T16:30:00Z'))).toEqual({
      academicYear: '2026-2027',
      semester: 'first',
    });
  });

  it.each([
    [{ academicYear: '2026-2027', semester: 'first' }, { academicYear: '2025-2026', semester: 'midyear' }],
    [{ academicYear: '2026-2027', semester: 'second' }, { academicYear: '2026-2027', semester: 'first' }],
    [{ academicYear: '2026-2027', semester: 'midyear' }, { academicYear: '2026-2027', semester: 'second' }],
  ] as const)('the semester before %o is %o', (key, before) => {
    expect(previousSemesterKey(key)).toEqual(before);
  });
});

describe('leaderboard queries', () => {
  it('requires a board type', () => {
    expect(leaderboardQuerySchema.safeParse({}).success).toBe(false);
    expect(leaderboardQuerySchema.safeParse({ type: 'ALL' }).success).toBe(false);
    expect(leaderboardQuerySchema.safeParse({ type: 'ISSC' }).success).toBe(false);
    expect(leaderboardQuerySchema.parse({ type: 'SBO' })).toEqual({ type: 'SBO' });
  });

  it('takes the academic year and semester together or not at all', () => {
    const both = { type: 'CSC', academicYear: '2026-2027', semester: 'first' };
    expect(leaderboardQuerySchema.safeParse(both).success).toBe(true);
    expect(leaderboardQuerySchema.safeParse({ type: 'CSC', semester: 'first' }).success).toBe(false);
    expect(
      leaderboardStreamQuerySchema.safeParse({ academicYear: '2026-2027' }).success,
    ).toBe(false);
    expect(leaderboardStreamQuerySchema.safeParse({}).success).toBe(true);
  });

  it('refuses unknown parameters and bad values', () => {
    expect(leaderboardQuerySchema.safeParse({ type: 'SBO', page: '2' }).success).toBe(false);
    expect(leaderboardQuerySchema.safeParse({ type: 'SBO', college: 'Not A Slug' }).success).toBe(
      false,
    );
    expect(
      leaderboardStreamQuerySchema.safeParse({ academicYear: '2026-2028', semester: 'first' })
        .success,
    ).toBe(false);
  });
});

describe('publicLeaderboardRowSchema', () => {
  const row = {
    rank: 1,
    rankChange: null,
    points: 4.5,
    implementedCount: 5,
    lateCount: 1,
    netProfitCentavos: -123400,
    underReviewCount: 0,
    organization: {
      type: 'SBO',
      slug: 'jpice',
      acronym: 'JPICE',
      name: 'Junior Philippine Institute of Civil Engineers',
      logoUrl: null,
      logoSrcSet: null,
    },
    college: { code: 'CEA', slug: 'cea', name: 'College of Engineering and Architecture' },
  };

  it('accepts a negative net profit', () => {
    expect(publicLeaderboardRowSchema.safeParse(row).success).toBe(true);
  });

  it('drops anything outside the public fields (spec 5F)', () => {
    const parsed = publicLeaderboardRowSchema.parse({
      ...row,
      organizationId: 'internal',
      actingAs: 'Juan dela Cruz',
    });
    expect(parsed).not.toHaveProperty('actingAs');
    expect(parsed).not.toHaveProperty('organizationId');
  });
});
