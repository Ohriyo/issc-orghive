import {
  LEADERBOARD_TYPES,
  semesterRange,
  type LeaderboardType,
  type ProjectTaskType,
  type Semester,
} from '@orghive/shared';
import type { LeaderboardStore } from '#src/lib/leaderboard-store';
import type {
  LeaderboardRepository,
  StandingOrgRecord,
} from '#src/repositories/leaderboard.repository';
import {
  rankStandings,
  type OrganizationStandingFacts,
  type Standing,
} from '#src/services/leaderboard-rules';
import type { SystemSettingsService } from '#src/services/system-settings.service';

/** A ranked row plus how it moved since the standings last changed. */
export interface LeaderboardRow extends Standing {
  /** Places gained (positive) or lost (negative); null when it was not ranked before. */
  rankChange: number | null;
}

export interface SemesterKey {
  academicYear: string;
  semester: Semester;
}

export type Boards = Record<LeaderboardType, LeaderboardRow[]>;

export interface LeaderboardServiceDeps {
  leaderboard: Pick<LeaderboardRepository, 'standingFacts' | 'latestSnapshot' | 'saveSnapshot'>;
  settings: Pick<SystemSettingsService, 'latePoints'>;
  store: LeaderboardStore;
  now?: () => Date;
}

/** Even unchanged standings get a snapshot this often, for the history (spec section 5). */
const DAILY_MS = 24 * 60 * 60 * 1000;

/** A task's file counts while it passed the scan and is not deleted. */
const FILED_STATUSES = new Set(['available', 'archived']);

/** The ranking's input, read from the stored organizations and projects. */
export function standingFactsOf(record: StandingOrgRecord): OrganizationStandingFacts {
  return {
    organizationId: record.id,
    type: record.type,
    name: record.name,
    projects: record.projects.map((project) => {
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
    }),
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
 * writes a snapshot when the standings changed (or a day passed) and puts the boards in the
 * store. Recomputing unchanged standings writes nothing new, so it is safe to run often.
 */
export function createLeaderboardService({
  leaderboard,
  settings,
  store,
  now = () => new Date(),
}: LeaderboardServiceDeps) {
  async function computeBoard(
    semester: SemesterKey,
    type: LeaderboardType,
    standings: Standing[],
    at: Date,
  ): Promise<LeaderboardRow[]> {
    const key = { ...semester, type };
    const previous = await leaderboard.latestSnapshot(key);
    const before = previous ? snapshotRows(previous.rows) : null;

    let rows: LeaderboardRow[];
    if (before && standingsKey(before) === standingsKey(standings)) {
      // Nothing moved: keep the arrows from the last change.
      rows = before;
      if (at.getTime() - previous!.computedAt.getTime() >= DAILY_MS) {
        await leaderboard.saveSnapshot(key, rows, at);
      }
    } else {
      const rankBefore = new Map((before ?? []).map((r) => [r.organizationId, r.rank]));
      rows = standings.map((row) => {
        const was = rankBefore.get(row.organizationId);
        return { ...row, rankChange: was === undefined ? null : was - row.rank };
      });
      await leaderboard.saveSnapshot(key, rows, at);
    }
    await store.write(key, rows);
    return rows;
  }

  async function compute(semester: SemesterKey): Promise<Boards> {
    const at = now();
    const [records, latePoints] = await Promise.all([
      leaderboard.standingFacts(semesterRange(semester.academicYear, semester.semester)),
      settings.latePoints(),
    ]);
    const ranked = rankStandings(records.map(standingFactsOf), { latePoints, now: at });
    const boards = {} as Boards;
    for (const type of LEADERBOARD_TYPES) {
      boards[type] = await computeBoard(semester, type, ranked[type], at);
    }
    return boards;
  }

  return {
    compute,

    /** One board's current rows: from the store, or computed when it holds none. */
    async board(semester: SemesterKey, type: LeaderboardType): Promise<LeaderboardRow[]> {
      const stored = await store.read<LeaderboardRow>({ ...semester, type });
      return stored ?? (await compute(semester))[type];
    },
  };
}

export type LeaderboardService = ReturnType<typeof createLeaderboardService>;
