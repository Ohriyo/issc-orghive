import {
  LEADERBOARD_TYPES,
  type CollegeRef,
  type LeaderboardEvent,
  type LeaderboardQuery,
  type LeaderboardResponse,
  type LeaderboardStreamQuery,
  type LeaderboardType,
  type OrganizationSummary,
  type PublicLeaderboardRow,
  type SemesterKey,
} from '@orghive/shared';
import { type Cache, cacheKeys } from '#src/lib/cache';
import type { PublicUrl } from '#src/lib/public-url';
import type {
  LeaderboardRepository,
  PublicOrganizationRecord,
} from '#src/repositories/leaderboard.repository';
import { toOrganizationSummary } from '#src/services/college.service';
import type { LeaderboardRow, LeaderboardService } from '#src/services/leaderboard.service';
import { USUAL_SEMESTER_READER, type SemesterReader } from '#src/services/semester-calendar.service';

export interface PublicLeaderboardServiceDeps {
  leaderboard: Pick<LeaderboardService, 'board' | 'meta'>;
  organizations: Pick<LeaderboardRepository, 'publicOrganizations'>;
  semesters?: SemesterReader;
  cache: Pick<Cache, 'getOrSet'>;
  publicUrl: PublicUrl;
  now?: () => Date;
}

/** Organization names and logos change rarely; admin edits also delete the entry. */
export const LEADERBOARD_ORGS_TTL_SECONDS = 5 * 60;

interface PublicOrganization {
  organization: OrganizationSummary;
  college: CollegeRef | null;
  collegeSlug: string | null;
}

function toPublicOrganization(
  org: PublicOrganizationRecord,
  publicUrl: PublicUrl,
): PublicOrganization {
  return {
    organization: toOrganizationSummary(org, publicUrl),
    college: org.college,
    collegeSlug: org.college?.slug ?? null,
  };
}

/** A ranked row as the public sees it (spec 5F): the fields are picked, never spread. */
function toPublicRow(row: LeaderboardRow, org: PublicOrganization): PublicLeaderboardRow {
  return {
    rank: row.rank,
    rankChange: row.rankChange,
    points: row.points,
    implementedCount: row.implementedCount,
    lateCount: row.lateCount,
    netProfitCentavos: row.netProfitCentavos,
    underReviewCount: row.underReviewCount,
    organization: org.organization,
    college: org.college,
  };
}

/**
 * The public leaderboard reads (docs/PROJECT_WORKFLOW_SPEC.md 5F): GET /leaderboard and the
 * SSE stream's events. Rows come from the store (computed when missing); the organizations'
 * public fields are joined here, from a cached list, so a rename needs no recompute.
 */
export function createPublicLeaderboardService({
  leaderboard,
  organizations,
  semesters = USUAL_SEMESTER_READER,
  cache,
  publicUrl,
  now = () => new Date(),
}: PublicLeaderboardServiceDeps) {
  async function organizationsById(): Promise<Map<string, PublicOrganization>> {
    const entries = await cache.getOrSet(
      cacheKeys.leaderboardOrganizations(),
      LEADERBOARD_ORGS_TTL_SECONDS,
      async () => {
        const records = await organizations.publicOrganizations();
        return records.map((org) => [org.id, toPublicOrganization(org, publicUrl)] as const);
      },
    );
    return new Map(entries ?? []);
  }

  /** The asked semester, or the current one (Manila) when the query names none. */
  async function semesterOf(query: LeaderboardStreamQuery): Promise<SemesterKey> {
    return query.academicYear && query.semester
      ? { academicYear: query.academicYear, semester: query.semester }
      : (await semesters.load()).currentKey(now());
  }

  async function publicRows(
    semester: SemesterKey,
    type: LeaderboardType,
    orgs: Map<string, PublicOrganization>,
    collegeSlug?: string,
  ): Promise<PublicLeaderboardRow[]> {
    const rows = await leaderboard.board(semester, type);
    return rows.flatMap((row) => {
      const org = orgs.get(row.organizationId);
      // Not in the list: deleted since the board was computed. Its next recompute drops it.
      if (!org) return [];
      if (collegeSlug !== undefined && org.collegeSlug !== collegeSlug) return [];
      return [toPublicRow(row, org)];
    });
  }

  return {
    semesterOf,

    /** GET /leaderboard: one board. The college filter keeps each row's rank on the board. */
    async read(query: LeaderboardQuery): Promise<LeaderboardResponse> {
      const semester = await semesterOf(query);
      const [orgs, meta] = await Promise.all([organizationsById(), leaderboard.meta(semester)]);
      return {
        ...semester,
        ...meta,
        type: query.type,
        rows: await publicRows(semester, query.type, orgs, query.college),
      };
    },

    /** Both boards of a semester: what the stream sends on connect and on every change. */
    async boards(semester: SemesterKey): Promise<LeaderboardEvent> {
      const [orgs, meta] = await Promise.all([organizationsById(), leaderboard.meta(semester)]);
      const boards = {} as LeaderboardEvent['boards'];
      for (const type of LEADERBOARD_TYPES) {
        boards[type] = await publicRows(semester, type, orgs);
      }
      return { ...semester, ...meta, boards };
    },
  };
}

export type PublicLeaderboardService = ReturnType<typeof createPublicLeaderboardService>;
