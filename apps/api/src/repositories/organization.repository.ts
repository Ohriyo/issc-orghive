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
  logoWidths: true,
  parentId: true,
  deactivatedAt: true,
  constitutionDocumentId: true,
  parent: {
    select: {
      type: true,
      slug: true,
      acronym: true,
      name: true,
      logoKey: true,
      logoWidths: true,
      deletedAt: true,
    },
  },
  college: { select: { id: true, code: true, slug: true, name: true } },
} satisfies Prisma.OrganizationSelect;

/**
 * The public profile on top of the summary. Hidden officers are filtered here, so no public
 * response can include them.
 */
const publicProfileSelect = {
  ...organizationSelect,
  mission: true,
  vision: true,
  contactEmail: true,
  facebookUrl: true,
  coverKey: true,
  coverWidths: true,
  officers: {
    where: { isPublic: true },
    orderBy: { sortOrder: 'asc' },
    select: { position: true, name: true },
  },
  links: { orderBy: { sortOrder: 'asc' }, select: { url: true } },
} satisfies Prisma.OrganizationSelect;

export type PublicProfileRecord = Prisma.OrganizationGetPayload<{
  select: typeof publicProfileSelect;
}>;

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

    /** The public organization page: the summary plus its public profile. */
    findPublicProfile(slug: string): Promise<PublicProfileRecord | null> {
      return db.organization.findFirst({
        where: { slug, deletedAt: null },
        select: publicProfileSelect,
      });
    },

    listByType(type: OrganizationType): Promise<OrganizationRecord[]> {
      return db.organization.findMany({
        where: { type, deletedAt: null },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
        select: organizationSelect,
      });
    },

    /**
     * E.g. the SBOs of a CSC, for public browsing: in carousel order, without deactivated
     * ones (docs/DOMAIN_RULES.md, "Administration").
     */
    listChildren(parentId: string): Promise<OrganizationRecord[]> {
      return db.organization.findMany({
        where: { parentId, deletedAt: null, deactivatedAt: null },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
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
