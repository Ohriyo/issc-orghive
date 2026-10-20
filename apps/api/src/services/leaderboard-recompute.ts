import { currentSemesterKey, previousSemesterKey, semesterKeyOf, type SemesterKey } from '@orghive/shared';
import type { LeaderboardQueue } from '#src/lib/queue';
import type { Logger } from '#src/logger';
import type { ProjectRepository } from '#src/repositories/project.repository';

export interface LeaderboardRecomputeDeps {
  queue: LeaderboardQueue;
  projects: Pick<ProjectRepository, 'targetDateOfDocument'>;
  logger: Pick<Logger, 'warn'>;
  now?: () => Date;
}

/** A project's target date: a `YYYY-MM-DD` string, or the date column as Prisma reads it. */
export type EventDate = string | Date;

const isoDate = (date: EventDate) =>
  typeof date === 'string' ? date : date.toISOString().slice(0, 10);

/**
 * Where a change that may move the standings asks for a recompute (docs/LEADERBOARD_PHASES.md,
 * Phase 2). It only queues: the worker recomputes each semester at most once per 5 s. A
 * project counts in its event's semester, which can be a past one (spec 5B). Queueing never
 * fails the change that asked for it: a failure is logged and the daily run catches up.
 */
export function createLeaderboardRecompute({
  queue,
  projects,
  logger,
  now = () => new Date(),
}: LeaderboardRecomputeDeps) {
  async function enqueue(keys: SemesterKey[]): Promise<void> {
    const unique = new Map(keys.map((key) => [`${key.academicYear}:${key.semester}`, key]));
    for (const key of unique.values()) {
      try {
        await queue.enqueueRecompute(key);
      } catch (err) {
        logger.warn({ err, semester: key }, 'Leaderboard recompute could not be queued');
      }
    }
  }

  return {
    /** Projects with these target dates changed (both dates when one moved). */
    forEventDates(...dates: EventDate[]): Promise<void> {
      return enqueue(dates.map((date) => semesterKeyOf(isoDate(date))));
    },

    /** A file was deleted: when it was a task's file, its project's semester. */
    async forDocument(documentId: string): Promise<void> {
      try {
        const targetDate = await projects.targetDateOfDocument(documentId);
        if (targetDate) await enqueue([semesterKeyOf(isoDate(targetDate))]);
      } catch (err) {
        logger.warn({ err, documentId }, 'Leaderboard recompute could not be queued');
      }
    },

    /**
     * Something every board depends on changed (the late value, an organization deactivated):
     * the current semester and the previous one, which is still settling (spec 5B). Older
     * semesters keep their standings.
     */
    forOpenSemesters(): Promise<void> {
      return enqueue(openSemesters(now()));
    },
  };
}

export type LeaderboardRecompute = ReturnType<typeof createLeaderboardRecompute>;

/** The current and previous semester at an instant: what the daily run recomputes. */
export function openSemesters(at: Date): SemesterKey[] {
  const current = currentSemesterKey(at);
  return [current, previousSemesterKey(current)];
}
