import type { Prisma, ProjectTaskType } from '#src/generated/prisma/client';
import type { Db } from './prisma';

const freezeSelect = {
  id: true,
  organizationId: true,
  projectId: true,
  reports: true,
  frozenAt: true,
  liftedAt: true,
  project: { select: { id: true, name: true } },
} satisfies Prisma.OrgFreezeSelect;

export type FreezeRecord = Prisma.OrgFreezeGetPayload<{ select: typeof freezeSelect }>;

/**
 * Organization freezes (docs/PROJECT_WORKFLOW_SPEC.md, 3B). Open while `liftedAt` is null;
 * the database keeps at most one open freeze per project.
 */
export function createOrgFreezeRepository(db: Db) {
  return {
    /**
     * Opens a freeze for a project unless one is already open. Returns the new freeze, or
     * null when one was open: safe to call on every check (the partial unique index
     * `org_freezes_one_open_per_project` turns a duplicate into a skipped insert).
     */
    async openIfAbsent(input: {
      organizationId: string;
      projectId: string;
      reports: ProjectTaskType[];
      frozenAt: Date;
    }): Promise<FreezeRecord | null> {
      const [created] = await db.orgFreeze.createManyAndReturn({
        data: [input],
        skipDuplicates: true,
        select: freezeSelect,
      });
      return created ?? null;
    },

    findById(id: string): Promise<FreezeRecord | null> {
      return db.orgFreeze.findUnique({ where: { id }, select: freezeSelect });
    },

    /** Open freezes of an organization whose project is not deleted, oldest first. */
    listOpen(organizationId: string): Promise<FreezeRecord[]> {
      return db.orgFreeze.findMany({
        where: { organizationId, liftedAt: null, project: { deletedAt: null } },
        orderBy: { frozenAt: 'asc' },
        select: freezeSelect,
      });
    },

    async isFrozen(organizationId: string): Promise<boolean> {
      const open = await db.orgFreeze.count({
        where: { organizationId, liftedAt: null, project: { deletedAt: null } },
      });
      return open > 0;
    },
  };
}

export type OrgFreezeRepository = ReturnType<typeof createOrgFreezeRepository>;
