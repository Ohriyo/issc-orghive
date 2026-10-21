import type { LeaderboardEvent, PublicLeaderboardRow } from '@orghive/shared';

/** A public leaderboard row for tests: rank 1 point, ₱1,000.00, CEA, unless overridden. */
export function lbRow(
  slug: string,
  rank: number,
  overrides: Partial<PublicLeaderboardRow> = {},
): PublicLeaderboardRow {
  return {
    rank,
    rankChange: 0,
    points: 1,
    implementedCount: 1,
    lateCount: 0,
    netProfitCentavos: 100_000,
    underReviewCount: 0,
    organization: {
      type: 'SBO',
      slug,
      acronym: slug.toUpperCase(),
      name: `Name of ${slug}`,
      logoUrl: null,
      logoSrcSet: null,
    },
    college: { code: 'CEA', slug: 'cea', name: 'College of Engineering and Architecture' },
    ...overrides,
  };
}

export const LB_SEMESTER = { academicYear: '2026-2027', semester: 'first' as const };

export function lbEvent(
  sbo: PublicLeaderboardRow[],
  csc: PublicLeaderboardRow[] = [],
): LeaderboardEvent {
  return { ...LB_SEMESTER, latePoints: 0.5, boards: { SBO: sbo, CSC: csc } };
}
