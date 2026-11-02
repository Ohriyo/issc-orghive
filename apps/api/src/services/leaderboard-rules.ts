import {
  isCheckedTask,
  deadlineAfter,
  endOfManilaDay,
  manilaDate,
  POST_EVENT_REPORTS,
  USUAL_SEMESTERS,
  type SemesterCalendar,
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
   * When each task was submitted: its file first passed the checks (`submittedAt`), or later
   * for a file that replaced one flagged invalid (rankingSubmittedAt, integrity-rules.ts).
   * Only tasks whose file is still filed (not deleted, not refused).
   */
  submitted: Partial<Record<ProjectTaskType, Date>>;
  /**
   * Submitted tasks whose files do not count for ranking (spec section 6): legacy, flagged
   * invalid, warnings not cleared, or private. A required one holds the project back.
   */
  unverified: ProjectTaskType[];
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
  /**
   * Event day reached, ACR and Financial Report both submitted (spec 5B), and every required
   * task counts for ranking (section 6).
   */
  implemented: boolean;
  /** Required tasks that are submitted but do not count yet (section 6); empty otherwise. */
  held: ProjectTaskType[];
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
  /** Organizations the ISSC disqualified from this semester's board (spec 5B). */
  disqualified?: ReadonlySet<string>;
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
 * The tasks a project needs: the Proposal, ACR and Financial Report always, and each ticked
 * pre-event document (spec 2B). Other pre-event documents never.
 */
export function requiredTasks(project: ProjectStandingFacts): ProjectTaskType[] {
  return [
    'PROPOSAL',
    ...(project.nomRequired ? (['NOM'] as const) : []),
    ...(project.momRequired ? (['MOM'] as const) : []),
    ...(project.communicationLetterRequired ? (['COMMUNICATION_LETTER'] as const) : []),
    ...(project.attendanceSheetRequired ? (['ATTENDANCE_SHEET'] as const) : []),
    'ACR',
    'FINANCIAL_REPORT',
  ];
}

/**
 * One project's contribution (docs/PROJECT_WORKFLOW_SPEC.md, 5B to 5D, and section 6).
 * - Implemented: the event day has come (Manila) and the ACR and Financial Report are both
 *   submitted, whenever that happened (it counts in its event's semester).
 * - Late: a required task with a deadline (Proposal, a ticked Communication Letter or
 *   Attendance Sheet, ACR, Financial Report) was submitted after its original deadline, or
 *   that deadline passed with nothing submitted. A deadline an approved appeal set never
 *   makes a task on time.
 * - Profit: every submitted Financial Report with figures, implemented or not, late or not.
 * - Held: a required task is submitted but does not count for ranking (legacy, flagged,
 *   warnings not cleared, private). The project then earns no points and no profit.
 */
export function scoreProject(
  project: ProjectStandingFacts,
  { latePoints, now }: RankingOptions,
): ProjectScore {
  const acr = project.submitted.ACR;
  const financial = project.submitted.FINANCIAL_REPORT;
  const required = requiredTasks(project);
  const held = project.unverified.filter((type) => required.includes(type));
  const counted = held.length === 0;
  const implemented = counted && manilaDate(now) >= project.targetDate && !!acr && !!financial;
  const late = originalDeadlines(project).some(([type, due]) => {
    const at = project.submitted[type];
    return at ? at > due : now > due;
  });
  const figures = financial && counted ? project.figures : null;
  const underReview = figures?.underReview ?? false;
  return {
    implemented,
    held,
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
  const ranked = orgs.filter((o) => !options.disqualified?.has(o.organizationId));
  return {
    SBO: rankBoard(
      ranked.filter((o) => o.type === 'SBO'),
      options,
    ),
    CSC: rankBoard(
      ranked.filter((o) => o.type === 'CSC'),
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
 * - a Financial Report under review: its profit counts again once the ISSC clears it;
 * - required tasks that do not count yet (legacy, flagged, warnings, private: section 6):
 *   re-uploading on the template, or sharing, lets the project count.
 * Missing reports come first (they add points), then tasks to verify, each list by event date.
 */
export function standingHints(projects: OwnProjectFacts[], now: Date): StandingHint[] {
  const byEvent = [...projects].sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  const submit: StandingHint[] = [];
  const verify: StandingHint[] = [];
  const check: StandingHint[] = [];
  for (const project of byEvent) {
    const score = scoreProject(project, { latePoints: 1, now });
    const ref = { projectId: project.id, projectName: project.name };
    if (!score.implemented && manilaDate(now) >= project.targetDate) {
      const missing = POST_EVENT_REPORTS.filter((type) => !project.submitted[type]);
      if (missing.length > 0) submit.push({ kind: 'submit_reports', ...ref, missing, held: [] });
    }
    const held = score.held.filter(isCheckedTask);
    if (held.length > 0) verify.push({ kind: 'verify_tasks', ...ref, missing: [], held });
    if (score.underReview) check.push({ kind: 'check_figures', ...ref, missing: [], held: [] });
  }
  return [...submit, ...verify, ...check];
}

/**
 * Until when the organization can correct a project's figures (spec 5D, provisional): the
 * later of the last day of the project's semester and its post-event deadline, including
 * a deadline an approved appeal set.
 */
export function figuresCorrectableUntil(
  targetDate: string,
  postEventDueOverride: Date | null,
  calendar: SemesterCalendar = USUAL_SEMESTERS,
): Date {
  const { end } = calendar.rangeOf(calendar.keyOf(targetDate));
  const semesterEnd = endOfManilaDay(end);
  const postEvent = postEventDueOverride ?? deadlineAfter(targetDate);
  return postEvent > semesterEnd ? postEvent : semesterEnd;
}
