import type { Prisma } from '#src/generated/prisma/client';
import { projectSelect, type ProjectRecord } from './project.repository';
import type { Db } from './prisma';

const orgSelect = {
  id: true,
  type: true,
  slug: true,
  acronym: true,
  name: true,
  position: true,
  college: { select: { code: true, position: true } },
} satisfies Prisma.OrganizationSelect;

export type OverviewOrgRecord = Prisma.OrganizationGetPayload<{ select: typeof orgSelect }>;

/** Read-only queries for the compliance overview, batched across many organizations. */
export function createComplianceOverviewRepository(db: Db) {
  return {
    /**
     * The organizations an overview covers, in hierarchy order: every CSC and SBO, or the
     * SBOs of the given colleges. Deleted ones never; deactivated ones still (they can owe
     * reports).
     */
    async organizations(scope: { collegeIds?: string[] }): Promise<OverviewOrgRecord[]> {
      const rows = await db.organization.findMany({
        where: scope.collegeIds
          ? { type: 'SBO', collegeId: { in: scope.collegeIds }, deletedAt: null }
          : { type: { in: ['CSC', 'SBO'] }, deletedAt: null },
        select: orgSelect,
      });
      const rank = (org: OverviewOrgRecord) => [
        org.college?.position ?? -1,
        org.type === 'CSC' ? 0 : 1,
        org.position,
      ];
      return rows.sort((a, b) => {
        const [x, y] = [rank(a), rank(b)];
        for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
        return a.acronym.localeCompare(b.acronym);
      });
    },

    /** The colleges whose CSC is one of these organizations. */
    async collegesOfCscs(orgIds: string[]): Promise<string[]> {
      const rows = await db.organization.findMany({
        where: { id: { in: orgIds }, type: 'CSC', deletedAt: null, collegeId: { not: null } },
        select: { collegeId: true },
      });
      return rows.map((row) => row.collegeId!);
    },

    /** Projects of these organizations with a target date in [start, end] (Manila days). */
    projectsInRange(orgIds: string[], start: string, end: string): Promise<ProjectRecord[]> {
      return db.project.findMany({
        where: {
          organizationId: { in: orgIds },
          deletedAt: null,
          targetDate: { gte: new Date(`${start}T00:00:00Z`), lte: new Date(`${end}T00:00:00Z`) },
        },
        orderBy: [{ targetDate: 'asc' }, { id: 'asc' }],
        select: projectSelect,
      });
    },

    /** Since when each organization has been frozen (its oldest open freeze). */
    async openFreezes(orgIds: string[]): Promise<Map<string, Date>> {
      const rows = await db.orgFreeze.groupBy({
        by: ['organizationId'],
        where: { organizationId: { in: orgIds }, liftedAt: null },
        _min: { frozenAt: true },
      });
      return new Map(rows.map((row) => [row.organizationId, row._min.frozenAt!]));
    },

    /** How many appeals each organization has waiting for a decision. */
    async pendingAppeals(orgIds: string[]): Promise<Map<string, number>> {
      const rows = await db.appeal.groupBy({
        by: ['organizationId'],
        where: { organizationId: { in: orgIds }, status: 'pending' },
        _count: { _all: true },
      });
      return new Map(rows.map((row) => [row.organizationId, row._count._all]));
    },
  };
}

export type ComplianceOverviewRepository = ReturnType<typeof createComplianceOverviewRepository>;
