import {
  currentSemesterKey,
  formatPesos,
  formatPoints,
  pointsBreakdown,
  previousSemesterKey,
  SEMESTER_LABELS,
  semesterSchema,
  underReviewNote,
  type LeaderboardType,
  type PublicLeaderboardRow,
  type SemesterKey,
} from '@orghive/shared';

/*
 * The leaderboard's view models (docs/PROJECT_WORKFLOW_SPEC.md, section 5): pure shaping
 * from the public rows, shared by the homepage podiums, /leaderboard and the dashboard.
 */

export type Medal = 'gold' | 'silver' | 'bronze';

/** The Top 3 get a medal by rank, so tied organizations share it (1, 1, 3). */
export function medalOf(rank: number): Medal | null {
  return rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : null;
}

export interface RankChangeView {
  direction: 'up' | 'down' | 'same' | 'new';
  /** Places moved; 0 for same or new. */
  places: number;
  /** For screen readers and the tooltip: "Up 2 places since the last change". */
  label: string;
}

export function rankChangeOf(change: number | null): RankChangeView {
  if (change === null) return { direction: 'new', places: 0, label: 'New on the board' };
  if (change === 0) return { direction: 'same', places: 0, label: 'Same place as before' };
  const places = Math.abs(change);
  const unit = places === 1 ? 'place' : 'places';
  return change > 0
    ? { direction: 'up', places, label: `Up ${places} ${unit} since the last change` }
    : { direction: 'down', places, label: `Down ${places} ${unit} since the last change` };
}

export interface ProfitView {
  /** `₱12,345.00`, or `−₱1,234.00`. */
  text: string;
  negative: boolean;
  /** "(1 report under review)", or empty. */
  underReview: string;
}

export function profitOf(row: PublicLeaderboardRow): ProfitView {
  return {
    text: formatPesos(row.netProfitCentavos),
    negative: row.netProfitCentavos < 0,
    underReview: underReviewNote(row.underReviewCount),
  };
}

/** One ranked organization, ready to draw: on a podium or in the list. */
export interface StandingView {
  /** Its slug: the key that lets cards and rows animate to their new place. */
  key: string;
  rank: number;
  medal: Medal | null;
  change: RankChangeView;
  acronym: string;
  name: string;
  logoSrc?: string;
  logoSrcSet?: string;
  /** The college's code, e.g. "CEA"; null for an organization without one. */
  college: string | null;
  /** "4.5 pts · 5 projects (1 late)" (spec 5C). */
  breakdown: string;
  profit: ProfitView;
  href: string;
}

export function toStandingView(row: PublicLeaderboardRow): StandingView {
  const org = row.organization;
  return {
    key: org.slug,
    rank: row.rank,
    medal: medalOf(row.rank),
    change: rankChangeOf(row.rankChange),
    acronym: org.acronym,
    name: org.name,
    logoSrc: org.logoUrl ?? undefined,
    logoSrcSet: org.logoSrcSet ?? undefined,
    college: row.college?.code ?? null,
    breakdown: pointsBreakdown(row.points, row.implementedCount, row.lateCount),
    profit: profitOf(row),
    href: `/orgs/${org.slug}`,
  };
}

/**
 * The podium holds the first three rows that rank in the Top 3; everything after is the
 * list. A tie for third (1, 2, 3, 3) puts the second third in the list, still with its
 * medal. With a college filter, the podium shows only that college's Top 3 entries.
 */
export function splitBoard(rows: PublicLeaderboardRow[]): {
  podium: StandingView[];
  list: StandingView[];
} {
  const views = rows.map(toStandingView);
  const firstOutside = views.findIndex((v) => v.rank > 3);
  const podiumSize = Math.min(3, firstOutside === -1 ? views.length : firstOutside);
  return { podium: views.slice(0, podiumSize), list: views.slice(podiumSize) };
}

/** The Top 3's order, to notice a live change ("jpice,psme,uapsa"). */
export function podiumSignature(rows: PublicLeaderboardRow[]): string {
  return splitBoard(rows)
    .podium.map((v) => v.key)
    .join(',');
}

/** The note under every board (spec 5C and 5D), with the late value in force. */
export function scoringNote(latePoints: number): string {
  return `Ranked by points (1 per implemented project, ${formatPoints(latePoints)} if any of its reports was late), then by net profit reported in submitted Financial Reports.`;
}

export const BOARD_LABELS: Record<LeaderboardType, { short: string; long: string }> = {
  SBO: { short: 'SBO', long: 'Student Body Organizations' },
  CSC: { short: 'CSC', long: 'Collegiate Student Councils' },
};

/** `2026-2027:first` ↔ the semester it names. */
export const semesterValue = ({ academicYear, semester }: SemesterKey) =>
  `${academicYear}:${semester}`;

export function parseSemesterValue(value: string | null): SemesterKey | null {
  const match = /^(\d{4}-\d{4}):(\w+)$/.exec(value ?? '');
  const semester = semesterSchema.safeParse(match?.[2]);
  return match && semester.success ? { academicYear: match[1]!, semester: semester.data } : null;
}

/** "1st semester 2026–2027". */
export function semesterLabel({ academicYear, semester }: SemesterKey): string {
  return `${SEMESTER_LABELS[semester]} ${academicYear.replace('-', '–')}`;
}

/** How many semesters the picker offers, the current one first. */
export const SEMESTER_CHOICES = 6;

export function semesterChoices(now: Date): { value: string; label: string }[] {
  const choices: SemesterKey[] = [currentSemesterKey(now)];
  while (choices.length < SEMESTER_CHOICES) choices.push(previousSemesterKey(choices.at(-1)!));
  return choices.map((key) => ({ value: semesterValue(key), label: semesterLabel(key) }));
}
