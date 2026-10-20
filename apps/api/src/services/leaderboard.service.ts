import {
  LEADERBOARD_TYPES,
  semesterRange,
  type LeaderboardType,
  type ProjectTaskType,
  type SemesterKey,
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
import type { SystemSettingsService } from '#src/services/system-settings.service';

/** A ranked row plus how it moved since the standings last changed. */
export interface LeaderboardRow extends Standing {
  /** Places gained (positive) or lost (negative); null when it was not ranked before. */
  rankChange: number | null;
}

export type { SemesterKey };

export type Boards = Record<LeaderboardType, LeaderboardRow[]>;

export interface LeaderboardServiceDeps {
  leaderboard: Pick<LeaderboardRepository, 'standingFacts' | 'latestSnapshot' | 'saveSnapshot'>;
  settings: Pick<SystemSettingsService, 'latePoints'>;
  store: LeaderboardStore;
  /** Told when a semester's standings changed (the API instances push it to SSE clients). */
  events?: LeaderboardEvents;
  now?: () => Date;
}

/** Even unchanged standings get a snapshot this often, for the history (spec section 5). */
const DAILY_MS = 24 * 60 * 60 * 1000;

/** A task's file counts while it passed the scan and is not deleted. */
const FILED_STATUSES = new Set(['available', 'archived']);

/** One project's ranking input, read from the stored project. */
export function projectFactsOf(
  project: StandingOrgRecord['projects'][number],
): ProjectStandingFacts {
  const submitted: Partial<Record<ProjectTaskType, Date>> = {};
  for (const task of project.tasks) {
    const doc = task.document;
    if (task.submittedAt && doc && !doc.deletedAt && FILED_STATUSES.has(doc.status)) {
      submitted[task.type] = task.submittedAt;
    }
  }
  return {
    createdAt: project.createdAt,
    targetDate: project.targetDate.toISOString().slice(0, 10),
    nomRequired: project.nomRequired,
    momRequired: project.momRequired,
    submitted,
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
 * writes and publishes nothing new, so it is safe to run often.
 */
export function createLeaderboardService({
  leaderboard,
  settings,
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

  async function compute(semester: SemesterKey): Promise<Boards> {
    const at = now();
    const [records, latePoints] = await Promise.all([
      leaderboard.standingFacts(semesterRange(semester.academicYear, semester.semester)),
      settings.latePoints(),
    ]);
    const ranked = rankStandings(records.map(standingFactsOf), { latePoints, now: at });
    const boards = {} as Boards;
    let changed = false;
    for (const type of LEADERBOARD_TYPES) {
      const board = await computeBoard(semester, type, ranked[type], at);
      boards[type] = board.rows;
      changed ||= board.changed;
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

    /** One board's current rows: from the store, or computed when it holds none. */
    async board(semester: SemesterKey, type: LeaderboardType): Promise<LeaderboardRow[]> {
      const stored = await store.read<LeaderboardRow>({ ...semester, type });
      return stored ?? (await computeShared(semester))[type];
    },
  };
}

export type LeaderboardService = ReturnType<typeof createLeaderboardService>;
