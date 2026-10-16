import type { OrganizationType, Prisma } from '#src/generated/prisma/client';
import type { Db } from './prisma';

const organizationSelect = {
  id: true,
  type: true,
  slug: true,
  acronym: true,
  name: true,
  description: true,
  logoKey: true,
  parentId: true,
  parent: {
    select: { type: true, slug: true, acronym: true, name: true, logoKey: true, deletedAt: true },
  },
  college: { select: { id: true, code: true, slug: true, name: true } },
} satisfies Prisma.OrganizationSelect;

export type OrganizationRecord = Prisma.OrganizationGetPayload<{
  select: typeof organizationSelect;
}>;

/** Soft-deleted organizations are never returned. */
export function createOrganizationRepository(db: Db) {
  return {
    findBySlug(slug: string): Promise<OrganizationRecord | null> {
      return db.organization.findFirst({
        where: { slug, deletedAt: null },
        select: organizationSelect,
      });
    },

    listByType(type: OrganizationType): Promise<OrganizationRecord[]> {
      return db.organization.findMany({
        where: { type, deletedAt: null },
        orderBy: { name: 'asc' },
        select: organizationSelect,
      });
    },

    /** E.g. the SBOs of a CSC. */
    listChildren(parentId: string): Promise<OrganizationRecord[]> {
      return db.organization.findMany({
        where: { parentId, deletedAt: null },
        orderBy: { name: 'asc' },
        select: organizationSelect,
      });
    },

    async listIds(where: { type?: OrganizationType; parentIds?: string[] }): Promise<string[]> {
      const rows = await db.organization.findMany({
        where: {
          deletedAt: null,
          type: where.type,
          ...(where.parentIds && { parentId: { in: where.parentIds } }),
        },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
  };
}

export type OrganizationRepository = ReturnType<typeof createOrganizationRepository>;
