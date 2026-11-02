import {
  manilaDate,
  nextSemesterKey,
  provisionalUntil,
  semesterCalendar,
  semesterDatesProblem,
  semesterKeysOfYears,
  USUAL_SEMESTERS,
  type AdminSemestersResponse,
  type SemesterCalendar,
  type SemesterCalendarResponse,
  type SemesterKey,
  type SetSemesterDatesRequest,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { type Cache, cacheKeys } from '#src/lib/cache';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { SemesterDatesRepository } from '#src/repositories/semester-dates.repository';
import type { RequestContext } from '#src/services/auth.service';
import type { LeaderboardRecompute } from '#src/services/leaderboard-recompute';
import type { LeaderboardService } from '#src/services/leaderboard.service';
import type { SystemSettingsService } from '#src/services/system-settings.service';

/** Where services read the semester calendar from. */
export interface SemesterReader {
  load(): Promise<SemesterCalendar>;
}

/** No dates set: the default for services whose tests do not care about the calendar. */
export const USUAL_SEMESTER_READER: SemesterReader = {
  load: () => Promise.resolve(USUAL_SEMESTERS),
};

/** The dates change a few times a year, and every change deletes the entry. */
export const SEMESTER_CALENDAR_TTL_SECONDS = 15 * 60;

export function createSemesterReader({
  dates,
  cache,
}: {
  dates: Pick<SemesterDatesRepository, 'all'>;
  cache: Pick<Cache, 'getOrSet'>;
}): SemesterReader {
  return {
    async load() {
      const set = await cache.getOrSet(
        cacheKeys.semesterCalendar(),
        SEMESTER_CALENDAR_TTL_SECONDS,
        () => dates.all(),
      );
      return semesterCalendar(set ?? []);
    },
  };
}

export interface SemesterCalendarServiceDeps {
  dates: Pick<SemesterDatesRepository, 'save'>;
  semesters: SemesterReader;
  leaderboard: Pick<LeaderboardService, 'meta'>;
  settings: Pick<SystemSettingsService, 'finalAfterDays'>;
  recompute: Pick<LeaderboardRecompute, 'forSemesters'>;
  cache: Pick<Cache, 'deleteMatching'>;
  audit: Pick<AuditLogRepository, 'record'>;
  now?: () => Date;
}

/**
 * The semester calendar (spec 5B): anyone may read it, and the ISSC account sets a semester's
 * first and last day at /admin/semesters. Standings that are final keep their dates. Dates
 * that would make a semester final at once are refused, so a typing mistake cannot freeze it.
 */
export function createSemesterCalendarService({
  dates,
  semesters,
  leaderboard,
  settings,
  recompute,
  cache,
  audit,
  now = () => new Date(),
}: SemesterCalendarServiceDeps) {
  return {
    /** GET /semesters. */
    async read(): Promise<SemesterCalendarResponse> {
      return { semesters: [...(await semesters.load()).dates] };
    },

    /** GET /admin/semesters: this academic year and the next. */
    async adminList(): Promise<AdminSemestersResponse> {
      const [calendar, finalAfterDays] = await Promise.all([
        semesters.load(),
        settings.finalAfterDays(),
      ]);
      const thisYear = calendar.currentKey(now()).academicYear;
      const keys = semesterKeysOfYears(thisYear);
      const rows = await Promise.all(
        keys.map(async (key) => {
          const range = calendar.rangeOf(key);
          const meta = await leaderboard.meta(key);
          return {
            ...key,
            ...range,
            isSet: calendar.isSet(key),
            status: meta.status,
            provisionalUntil: provisionalUntil(range.end, finalAfterDays),
          };
        }),
      );
      return { finalAfterDays, semesters: rows };
    },

    /** PUT /admin/semesters/:academicYear/:semester. */
    async set(
      userId: string,
      key: SemesterKey,
      input: SetSemesterDatesRequest,
      ctx: RequestContext,
    ): Promise<AdminSemestersResponse> {
      const [calendar, finalAfterDays, meta] = await Promise.all([
        semesters.load(),
        settings.finalAfterDays(),
        leaderboard.meta(key),
      ]);
      if (meta.status === 'final') {
        throw AppError.conflict(
          'The standings of this semester are final, so its dates can no longer change.',
        );
      }
      const problem = semesterDatesProblem(calendar, { ...key, start: input.start, end: input.end });
      if (problem) throw AppError.conflict(problem);
      if (provisionalUntil(input.end, finalAfterDays) < manilaDate(now())) {
        throw AppError.conflict(
          `That last day would make this semester’s standings final at once, as they stay provisional for only ${finalAfterDays} days after it. Check the date.`,
        );
      }

      const { start, end } = calendar.rangeOf(key);
      await dates.save(key, input, userId);
      await cache.deleteMatching(cacheKeys.semesterCalendar());
      await audit.record({
        action: 'semester_dates_change',
        actorId: userId,
        entityType: 'semester',
        entityId: `${key.academicYear}:${key.semester}`,
        metadata: { before: { start, end }, after: { start: input.start, end: input.end } },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        actingAs: input.actingAs,
      });
      // A last day moves events between this semester and the next.
      await recompute.forSemesters(key, nextSemesterKey(key));
      return this.adminList();
    },
  };
}

export type SemesterCalendarService = ReturnType<typeof createSemesterCalendarService>;
