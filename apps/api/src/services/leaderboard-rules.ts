import {
  academicYearOf,
  deadlineAfter,
  endOfManilaDay,
  manilaDate,
  semesterOf,
  POST_EVENT_REPORTS,
  semesterRange,
  type LeaderboardType,
  type ProjectTaskType,
  type StandingHint,
} from '@orghive/shared';

/** What the ranking needs to know about one project of the semester. */
export interface ProjectStandingFacts {
  createdAt: Date;
  /** The event date in Manila, `YYYY-MM-DD`. */
  targetDate: string;
  nomRequired: boolean;
  momRequired: boolean;
  /** Ticked pre-event documents with a deadline count toward lateness (spec 5C). */
  communicationLetterRequired: boolean;
  attendanceSheetRequired: boolean;
  /**
   * When each task was submitted: its file first passed the virus scan (`submittedAt`).
   * Only tasks whose file is still filed (not deleted, not refused).
   */
  submitted: Partial<Record<ProjectTaskType, Date>>;
  /** The Financial Report's totals, when entered. */
  figures: { incomeCentavos: number; expensesCentavos: number; underReview: boolean } | null;
}

export interface OrganizationStandingFacts {
  organizationId: string;
  type: 'ISSC' | LeaderboardType;
  /** Ties that survive every rule are listed by name. */
  name: string;
  /** Its projects whose target date falls in the semester. */
  projects: ProjectStandingFacts[];
}

export interface ProjectScore {
  /** Event day reached, ACR and Financial Report both submitted (spec 5B). */
  implemented: boolean;
  /** A required task was not submitted by its original deadline (spec 5C). */
  late: boolean;
  /** Hundredths of a point: 100 on time, the late value late, 0 when not implemented. */
  points: number;
  /** The later of the ACR's and Financial Report's submission, when implemented. */
  completedAt: Date | null;
  /** Income − expenses of a submitted Financial Report; null without one. */
  netCentavos: number | null;
  /** A submitted Financial Report whose figures the ISSC flagged (left out of the total). */
  underReview: boolean;
}

export interface Standing {
  organizationId: string;
  rank: number;
  /** In points (4.5), from hundredths, so a late value like 0.3 adds up exactly. */
  points: number;
  implementedCount: number;
  lateCount: number;
  netProfitCentavos: number;
  underReviewCount: number;
  /** ISO instant: the latest completion among implemented projects (the tie-breaker). */
  lastCompletedAt: string;
}

export interface RankingOptions {
  /** Points for a late implemented project, 0 to 1 (the system setting, spec 5C). */
  latePoints: number;
  now: Date;
}

const ON_TIME = 100;

/**
 * Each required task's original deadline (spec 5C). NOM, MOM and other pre-event documents
 * have none, so they are never late. A ticked Communication Letter is due at the end of the
 * event day; a ticked Attendance Sheet with the ACR. Same dates as planProject's, without
 * appeal overrides.
 */
export function originalDeadlines(project: ProjectStandingFacts): [ProjectTaskType, Date][] {
  const postEvent = deadlineAfter(project.targetDate);
  return [
    ['PROPOSAL', deadlineAfter(project.createdAt)],
    ...(project.communicationLetterRequired
      ? [['COMMUNICATION_LETTER', endOfManilaDay(project.targetDate)] as [ProjectTaskType, Date]]
      : []),
    ...(project.attendanceSheetRequired
      ? [['ATTENDANCE_SHEET', postEvent] as [ProjectTaskType, Date]]
      : []),
    ['ACR', postEvent],
    ['FINANCIAL_REPORT', postEvent],
  ];
}

/**
 * One project's contribution (docs/PROJECT_WORKFLOW_SPEC.md, 5B to 5D).
 * - Implemented: the event day has come (Manila) and the ACR and Financial Report are both
 *   submitted, whenever that happened (it counts in its event's semester).
 * - Late: a required task with a deadline (Proposal, a ticked Communication Letter or
 *   Attendance Sheet, ACR, Financial Report) was submitted after its original deadline, or
 *   that deadline passed with nothing submitted. A deadline an approved appeal set never
 *   makes a task on time.
 * - Profit: every submitted Financial Report with figures, implemented or not, late or not.
 */
export function scoreProject(
  project: ProjectStandingFacts,
  { latePoints, now }: RankingOptions,
): ProjectScore {
  const acr = project.submitted.ACR;
  const financial = project.submitted.FINANCIAL_REPORT;
  const implemented = manilaDate(now) >= project.targetDate && !!acr && !!financial;
  const late = originalDeadlines(project).some(([type, due]) => {
    const at = project.submitted[type];
    return at ? at > due : now > due;
  });
  const figures = financial ? project.figures : null;
  const underReview = figures?.underReview ?? false;
  return {
    implemented,
    late: implemented && late,
    points: implemented ? (late ? Math.round(latePoints * 100) : ON_TIME) : 0,
    completedAt: implemented ? new Date(Math.max(acr.getTime(), financial.getTime())) : null,
    netCentavos: figures && !underReview ? figures.incomeCentavos - figures.expensesCentavos : null,
    underReview,
  };
}

/** One organization's totals, or null while it has no implemented project (spec 5A). */
function totalsOf(
  org: OrganizationStandingFacts,
  options: RankingOptions,
): (Omit<Standing, 'rank'> & { hundredths: number; name: string }) | null {
  let hundredths = 0;
  let implementedCount = 0;
  let lateCount = 0;
  let netProfitCentavos = 0;
  let underReviewCount = 0;
  let lastCompleted = 0;
  for (const project of org.projects) {
    const score = scoreProject(project, options);
    hundredths += score.points;
    if (score.implemented) implementedCount += 1;
    if (score.late) lateCount += 1;
    if (score.netCentavos !== null) netProfitCentavos += score.netCentavos;
    if (score.underReview) underReviewCount += 1;
    if (score.completedAt) lastCompleted = Math.max(lastCompleted, score.completedAt.getTime());
  }
  if (implementedCount === 0) return null;
  return {
    organizationId: org.organizationId,
    name: org.name,
    hundredths,
    points: hundredths / 100,
    implementedCount,
    lateCount,
    netProfitCentavos,
    underReviewCount,
    lastCompletedAt: new Date(lastCompleted).toISOString(),
  };
}

type Totals = NonNullable<ReturnType<typeof totalsOf>>;

/** Negative when `a` ranks above `b`; 0 when the three rules cannot tell them apart. */
function compareStandings(a: Totals, b: Totals): number {
  return (
    b.hundredths - a.hundredths ||
    b.netProfitCentavos - a.netProfitCentavos ||
    Date.parse(a.lastCompletedAt) - Date.parse(b.lastCompletedAt)
  );
}

function rankBoard(orgs: OrganizationStandingFacts[], options: RankingOptions): Standing[] {
  const totals = orgs.flatMap((org) => totalsOf(org, options) ?? []);
  totals.sort((a, b) => compareStandings(a, b) || a.name.localeCompare(b.name, 'en'));
  return totals.map((row, i) => {
    // Competition ranking: a full tie shares the rank of the first of them (1, 1, 3).
    let first = i;
    while (first > 0 && compareStandings(totals[first - 1]!, row) === 0) first -= 1;
    return {
      organizationId: row.organizationId,
      rank: first + 1,
      points: row.points,
      implementedCount: row.implementedCount,
      lateCount: row.lateCount,
      netProfitCentavos: row.netProfitCentavos,
      underReviewCount: row.underReviewCount,
      lastCompletedAt: row.lastCompletedAt,
    };
  });
}

/**
 * The leaderboard's ranking (docs/PROJECT_WORKFLOW_SPEC.md, section 5), in one pure function.
 * SBOs and CSCs are ranked separately and the ISSC never. Within a board:
 * 1. points, highest first (1 per implemented project, the late value when late);
 * 2. total net profit, highest first (flagged figures left out);
 * 3. the earliest last completion first;
 * 4. still tied: the same rank, listed by name.
 * Organizations without an implemented project are not ranked.
 */
export function rankStandings(
  orgs: OrganizationStandingFacts[],
  options: RankingOptions,
): Record<LeaderboardType, Standing[]> {
  return {
    SBO: rankBoard(
      orgs.filter((o) => o.type === 'SBO'),
      options,
    ),
    CSC: rankBoard(
      orgs.filter((o) => o.type === 'CSC'),
      options,
    ),
  };
}

/** A project of the organization's own, with what its dashboard names it by. */
export interface OwnProjectFacts extends ProjectStandingFacts {
  id: string;
  name: string;
}

/**
 * What would move an organization up its board (its dashboard, spec section 5), from the
 * same scoring as the ranking:
 * - an event day that has come whose ACR or Financial Report is still missing: submitting
 *   them implements the project (a point, or the late value);
 * - a Financial Report under review: its profit counts again once the ISSC clears it.
 * Missing reports come first (they add points), each list by event date.
 */
export function standingHints(projects: OwnProjectFacts[], now: Date): StandingHint[] {
  const byEvent = [...projects].sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  const submit: StandingHint[] = [];
  const check: StandingHint[] = [];
  for (const project of byEvent) {
    const score = scoreProject(project, { latePoints: 1, now });
    const ref = { projectId: project.id, projectName: project.name };
    if (!score.implemented && manilaDate(now) >= project.targetDate) {
      const missing = POST_EVENT_REPORTS.filter((type) => !project.submitted[type]);
      if (missing.length > 0) submit.push({ kind: 'submit_reports', ...ref, missing });
    }
    if (score.underReview) check.push({ kind: 'check_figures', ...ref, missing: [] });
  }
  return [...submit, ...check];
}

/**
 * Until when the organization can correct a project's figures (spec 5D, provisional): the
 * later of the last day of the project's semester and its post-event deadline, including
 * a deadline an approved appeal set.
 */
export function figuresCorrectableUntil(
  targetDate: string,
  postEventDueOverride: Date | null,
): Date {
  const { end } = semesterRange(academicYearOf(targetDate), semesterOf(targetDate));
  const semesterEnd = endOfManilaDay(end);
  const postEvent = postEventDueOverride ?? deadlineAfter(targetDate);
  return postEvent > semesterEnd ? postEvent : semesterEnd;
}
