import {
  previousSemesterKey,
  USUAL_SEMESTERS,
  type SemesterCalendar,
  type SemesterKey,
} from '@orghive/shared';
import type { LeaderboardQueue } from '#src/lib/queue';
import type { Logger } from '#src/logger';
import type { ProjectRepository } from '#src/repositories/project.repository';
import { USUAL_SEMESTER_READER, type SemesterReader } from '#src/services/semester-calendar.service';

export interface LeaderboardRecomputeDeps {
  queue: LeaderboardQueue;
  projects: Pick<ProjectRepository, 'targetDateOfDocument'>;
  logger: Pick<Logger, 'warn'>;
  semesters?: SemesterReader;
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
  semesters = USUAL_SEMESTER_READER,
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
    async forEventDates(...dates: EventDate[]): Promise<void> {
      try {
        const calendar = await semesters.load();
        await enqueue(dates.map((date) => calendar.keyOf(isoDate(date))));
      } catch (err) {
        logger.warn({ err }, 'Leaderboard recompute could not be queued');
      }
    },

    /** These semesters changed: their dates, or who is disqualified from them. */
    forSemesters(...keys: SemesterKey[]): Promise<void> {
      return enqueue(keys);
    },

    /** A file was deleted: when it was a task's file, its project's semester. */
    async forDocument(documentId: string): Promise<void> {
      try {
        const targetDate = await projects.targetDateOfDocument(documentId);
        if (targetDate) await enqueue([(await semesters.load()).keyOf(isoDate(targetDate))]);
      } catch (err) {
        logger.warn({ err, documentId }, 'Leaderboard recompute could not be queued');
      }
    },

    /**
     * Something every board depends on changed (the late value, an organization deactivated):
     * the semesters still settling (spec 5B). Final ones keep their standings.
     */
    async forOpenSemesters(): Promise<void> {
      try {
        await enqueue(openSemesters(now(), await semesters.load()));
      } catch (err) {
        logger.warn({ err }, 'Leaderboard recompute could not be queued');
      }
    },
  };
}

export type LeaderboardRecompute = ReturnType<typeof createLeaderboardRecompute>;

/**
 * The current semester and the two before it: what the daily run recomputes. Two, as a short
 * semester can pass while the one before it is still provisional. A final one is left as it
 * is, so including it costs nothing.
 */
export function openSemesters(
  at: Date,
  calendar: SemesterCalendar = USUAL_SEMESTERS,
): SemesterKey[] {
  const current = calendar.currentKey(at);
  const previous = previousSemesterKey(current);
  return [current, previous, previousSemesterKey(previous)];
}
