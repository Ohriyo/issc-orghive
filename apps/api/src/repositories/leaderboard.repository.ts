import type { LeaderboardType, Semester } from '@orghive/shared';
import type { Prisma } from '#src/generated/prisma/client';
import type { DateRange } from './financial-figures.repository';
import type { Db } from './prisma';

const asDate = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`);

/** The semester's undeleted projects: those whose target date falls in the range. */
const inRange = (range: DateRange) =>
  ({
    deletedAt: null,
    targetDate: { gte: asDate(range.start), lte: asDate(range.end) },
  }) satisfies Prisma.ProjectWhereInput;

/** What the ranking reads of one project. */
const projectStandingSelect = {
  createdAt: true,
  targetDate: true,
  nomRequired: true,
  momRequired: true,
  tasks: {
    where: { submittedAt: { not: null } },
    select: {
      type: true,
      submittedAt: true,
      // System view of the task's file: a deleted or refused file no longer counts.
      document: { select: { status: true, deletedAt: true } },
    },
  },
  figures: { select: { incomeCentavos: true, expensesCentavos: true, flaggedAt: true } },
} satisfies Prisma.ProjectSelect;

/** What the ranking reads of one organization and its projects in a semester. */
const standingSelect = (range: DateRange) =>
  ({
    id: true,
    type: true,
    name: true,
    projects: { where: inRange(range), select: projectStandingSelect },
  }) satisfies Prisma.OrganizationSelect;

/** One of an organization's own projects, with what its dashboard names it by. */
const ownProjectSelect = { id: true, name: true, ...projectStandingSelect } satisfies Prisma.ProjectSelect;

export type OwnProjectRecord = Prisma.ProjectGetPayload<{ select: typeof ownProjectSelect }>;

export type StandingOrgRecord = Prisma.OrganizationGetPayload<{
  select: ReturnType<typeof standingSelect>;
}>;

/** Only what spec 5F allows on a public board: no account, officer or document fields. */
const publicOrganizationSelect = {
  id: true,
  type: true,
  slug: true,
  acronym: true,
  name: true,
  logoKey: true,
  logoWidths: true,
  college: { select: { code: true, slug: true, name: true } },
} satisfies Prisma.OrganizationSelect;

export type PublicOrganizationRecord = Prisma.OrganizationGetPayload<{
  select: typeof publicOrganizationSelect;
}>;

export interface SnapshotKey {
  academicYear: string;
  semester: Semester;
  type: LeaderboardType;
}

export interface SnapshotRecord {
  rows: Prisma.JsonValue;
  computedAt: Date;
}

/** The leaderboard's reads (spec section 5) and its snapshot history. */
export function createLeaderboardRepository(db: Db) {
  return {
    /**
     * Every SBO and CSC that can be ranked (not deleted, not deactivated) with its projects
     * whose target date falls in the range. The ISSC is never ranked, so never read.
     */
    standingFacts(range: DateRange): Promise<StandingOrgRecord[]> {
      return db.organization.findMany({
        where: { type: { in: ['SBO', 'CSC'] }, deletedAt: null, deactivatedAt: null },
        orderBy: { id: 'asc' },
        select: standingSelect(range),
      });
    },

    /** One organization's projects of the semester, for its dashboard's hints. */
    ownProjects(organizationId: string, range: DateRange): Promise<OwnProjectRecord[]> {
      return db.project.findMany({
        where: { organizationId, ...inRange(range) },
        orderBy: [{ targetDate: 'asc' }, { id: 'asc' }],
        select: ownProjectSelect,
      });
    },

    /** The public fields of every SBO and CSC that is not deleted, for the boards' rows. */
    publicOrganizations(): Promise<PublicOrganizationRecord[]> {
      return db.organization.findMany({
        where: { type: { in: ['SBO', 'CSC'] }, deletedAt: null },
        orderBy: { id: 'asc' },
        select: publicOrganizationSelect,
      });
    },

    latestSnapshot(key: SnapshotKey): Promise<SnapshotRecord | null> {
      return db.leaderboardSnapshot.findFirst({
        where: key,
        orderBy: { computedAt: 'desc' },
        select: { rows: true, computedAt: true },
      });
    },

    /** `rows` are plain JSON values (the service's ranked rows). */
    async saveSnapshot(key: SnapshotKey, rows: readonly object[], at: Date): Promise<void> {
      await db.leaderboardSnapshot.create({
        data: { ...key, rows, computedAt: at },
      });
    },
  };
}

export type LeaderboardRepository = ReturnType<typeof createLeaderboardRepository>;
