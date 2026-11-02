import {
  isCheckedTask,
  LEADERBOARD_TYPES,
  manilaDate,
  provisionalUntil,
  type LeaderboardType,
  type ProjectTaskType,
  type SemesterKey,
  type StandingsStatus,
} from '@orghive/shared';
import type { LeaderboardEvents } from '#src/lib/leaderboard-events';
import type { LeaderboardStore } from '#src/lib/leaderboard-store';
import type {
  LeaderboardRepository,
  StandingOrgRecord,
} from '#src/repositories/leaderboard.repository';
import {
  rankStandings,
  type OrganizationStandingFacts,
  type ProjectStandingFacts,
  type Standing,
} from '#src/services/leaderboard-rules';
import { USUAL_SEMESTER_READER, type SemesterReader } from '#src/services/semester-calendar.service';
import type { SystemSettingsService } from '#src/services/system-settings.service';
import { fileFactsOf, rankingSubmittedAt, taskCountsForRanking } from './integrity-rules';

/** A ranked row plus how it moved since the standings last changed. */
export interface LeaderboardRow extends Standing {
  /** Places gained (positive) or lost (negative); null when it was not ranked before. */
  rankChange: number | null;
}

export type { SemesterKey };

export type Boards = Record<LeaderboardType, LeaderboardRow[]>;

/** What a board says about itself (spec 5B). */
export interface BoardMeta {
  status: StandingsStatus;
  /** The last provisional day. */
  provisionalUntil: string;
  /** The late value its points use: a final board keeps the one it was frozen with. */
  latePoints: number;
}

export interface LeaderboardServiceDeps {
  leaderboard: Pick<
    LeaderboardRepository,
    | 'standingFacts'
    | 'latestSnapshot'
    | 'saveSnapshot'
    | 'finalSnapshots'
    | 'saveFinal'
    | 'disqualifiedIn'
  >;
  settings: Pick<SystemSettingsService, 'latePoints' | 'finalAfterDays'>;
  semesters?: SemesterReader;
  store: LeaderboardStore;
  /** Told when a semester's standings changed (the API instances push it to SSE clients). */
  events?: LeaderboardEvents;
  now?: () => Date;
}

/** Even unchanged standings get a snapshot this often, for the history (spec section 5). */
const DAILY_MS = 24 * 60 * 60 * 1000;

/**
 * One project's ranking input, read from the stored project: when each task was submitted
 * (for lateness, rankingSubmittedAt), and which submitted tasks do not count for ranking.
 */
export function projectFactsOf(
  project: StandingOrgRecord['projects'][number],
): ProjectStandingFacts {
  const submitted: Partial<Record<ProjectTaskType, Date>> = {};
  const unverified: ProjectTaskType[] = [];
  for (const task of project.tasks) {
    const docs = [task.document, ...task.files.map((f) => f.document)].filter((d) => !!d);
    const files = docs.map(fileFactsOf).filter((f) => f.scanStatus === 'clean');
    if (!task.submittedAt || files.length === 0) continue;
    submitted[task.type] = rankingSubmittedAt(task.submittedAt, files)!;
    if (isCheckedTask(task.type) && !taskCountsForRanking(files)) unverified.push(task.type);
  }
  return {
    createdAt: project.createdAt,
    targetDate: project.targetDate.toISOString().slice(0, 10),
    nomRequired: project.nomRequired,
    momRequired: project.momRequired,
    communicationLetterRequired: project.communicationLetterRequired,
    attendanceSheetRequired: project.attendanceSheetRequired,
    submitted,
    unverified,
    figures: project.figures && {
      incomeCentavos: project.figures.incomeCentavos,
      expensesCentavos: project.figures.expensesCentavos,
      underReview: project.figures.flaggedAt !== null,
    },
  };
}

/** The ranking's input, read from the stored organizations and projects. */
export function standingFactsOf(record: StandingOrgRecord): OrganizationStandingFacts {
  return {
    organizationId: record.id,
    type: record.type,
    name: record.name,
    projects: record.projects.map(projectFactsOf),
  };
}

/** The rows of a stored snapshot; an unreadable one counts as none. */
function snapshotRows(rows: unknown): LeaderboardRow[] | null {
  return Array.isArray(rows) ? (rows as LeaderboardRow[]) : null;
}

/** The standings alone, without rank change: what decides whether anything changed. */
const standingsKey = (rows: Standing[]) =>
  JSON.stringify(
    rows.map((r) => [
      r.organizationId,
      r.rank,
      r.points,
      r.implementedCount,
      r.lateCount,
      r.netProfitCentavos,
      r.underReviewCount,
      r.lastCompletedAt,
    ]),
  );

/**
 * The leaderboard (docs/PROJECT_WORKFLOW_SPEC.md, section 5). `compute` ranks a semester with
 * `rankStandings`, works out each row's rank change against the last different standings,
 * writes a snapshot when the standings changed (or a day passed), puts the boards in the
 * store and, when they changed, publishes the semester. Recomputing unchanged standings
 * writes and publishes nothing new, so it is safe to run often. Standings are provisional
 * until the semester's last day plus the grace days (spec 5B); the first compute after that
 * freezes them as final, and from then on nothing recomputes the semester.
 */
export function createLeaderboardService({
  leaderboard,
  settings,
  semesters = USUAL_SEMESTER_READER,
  store,
  events,
  now = () => new Date(),
}: LeaderboardServiceDeps) {
  async function computeBoard(
    semester: SemesterKey,
    type: LeaderboardType,
    standings: Standing[],
    at: Date,
  ): Promise<{ rows: LeaderboardRow[]; changed: boolean }> {
    const key = { ...semester, type };
    const previous = await leaderboard.latestSnapshot(key);
    const before = previous ? snapshotRows(previous.rows) : null;

    let rows: LeaderboardRow[];
    let changed: boolean;
    if (before && standingsKey(before) === standingsKey(standings)) {
      // Nothing moved: keep the arrows from the last change.
      rows = before;
      changed = false;
      if (at.getTime() - previous!.computedAt.getTime() >= DAILY_MS) {
        await leaderboard.saveSnapshot(key, rows, at);
      }
    } else if (!before && standings.length === 0) {
      // Never ranked anyone: nothing to record, so a read of any old or future semester
      // leaves no snapshot behind.
      rows = [];
      changed = false;
    } else {
      const rankBefore = new Map((before ?? []).map((r) => [r.organizationId, r.rank]));
      rows = standings.map((row) => {
        const was = rankBefore.get(row.organizationId);
        return { ...row, rankChange: was === undefined ? null : was - row.rank };
      });
      changed = true;
      await leaderboard.saveSnapshot(key, rows, at);
    }
    await store.write(key, rows);
    return { rows, changed };
  }

  /** A final semester's boards, back in the store for the next read; null while provisional. */
  async function frozenBoards(semester: SemesterKey): Promise<Boards | null> {
    const finals = await leaderboard.finalSnapshots(semester);
    if (finals.length === 0) return null;
    const boards = {} as Boards;
    for (const type of LEADERBOARD_TYPES) {
      const final = finals.find((f) => f.type === type);
      boards[type] = (final && snapshotRows(final.rows)) ?? [];
      await store.write({ ...semester, type }, boards[type]);
    }
    return boards;
  }

  async function compute(semester: SemesterKey): Promise<Boards> {
    const frozen = await frozenBoards(semester);
    if (frozen) return frozen;

    const at = now();
    const [calendar, latePoints, finalAfterDays, disqualified] = await Promise.all([
      semesters.load(),
      settings.latePoints(),
      settings.finalAfterDays(),
      leaderboard.disqualifiedIn(semester),
    ]);
    const records = await leaderboard.standingFacts(calendar.spanOf(semester));
    const ranked = rankStandings(records.map(standingFactsOf), {
      latePoints,
      now: at,
      disqualified: new Set(disqualified),
    });
    const boards = {} as Boards;
    let changed = false;
    for (const type of LEADERBOARD_TYPES) {
      const board = await computeBoard(semester, type, ranked[type], at);
      boards[type] = board.rows;
      changed ||= board.changed;
    }

    // Nothing to freeze for a semester nobody was ranked in, so reading any old semester leaves
    // no rows behind.
    const closed =
      manilaDate(at) > provisionalUntil(calendar.rangeOf(semester).end, finalAfterDays);
    if (closed && LEADERBOARD_TYPES.some((type) => boards[type].length > 0)) {
      await leaderboard.saveFinal(
        semester,
        LEADERBOARD_TYPES.map((type) => ({ type, rows: boards[type] })),
        latePoints,
        at,
      );
      changed = true;
    }
    if (changed) await events?.publish(semester);
    return boards;
  }

  // When the store misses (Redis restarted), every stream reconnecting at once would compute
  // the same semester; they share one computation instead.
  const computing = new Map<string, Promise<Boards>>();
  function computeShared(semester: SemesterKey): Promise<Boards> {
    const id = `${semester.academicYear}:${semester.semester}`;
    let running = computing.get(id);
    if (!running) {
      running = compute(semester).finally(() => computing.delete(id));
      computing.set(id, running);
    }
    return running;
  }

  return {
    compute,

    /** Whether a semester's standings are final, and the late value its points use. */
    async meta(semester: SemesterKey): Promise<BoardMeta> {
      const [calendar, latePoints, finalAfterDays, finals] = await Promise.all([
        semesters.load(),
        settings.latePoints(),
        settings.finalAfterDays(),
        leaderboard.finalSnapshots(semester),
      ]);
      const until = provisionalUntil(calendar.rangeOf(semester).end, finalAfterDays);
      const frozen = finals[0];
      return {
        status: frozen || manilaDate(now()) > until ? 'final' : 'provisional',
        provisionalUntil: until,
        latePoints: frozen?.latePoints ?? latePoints,
      };
    },

    /** One board's current rows: from the store, or computed when it holds none. */
    async board(semester: SemesterKey, type: LeaderboardType): Promise<LeaderboardRow[]> {
      const stored = await store.read<LeaderboardRow>({ ...semester, type });
      return stored ?? (await computeShared(semester))[type];
    },
  };
}

export type LeaderboardService = ReturnType<typeof createLeaderboardService>;
