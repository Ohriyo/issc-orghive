import type { OrganizationType, Prisma } from '#src/generated/prisma/client';
import type { Db } from './prisma';

/** What the admin screens show of an organization, with its live counts. */
const ADMIN_ORG_SELECT = {
  id: true,
  type: true,
  slug: true,
  acronym: true,
  name: true,
  description: true,
  logoKey: true,
  logoWidths: true,
  position: true,
  collegeId: true,
  parentId: true,
  deactivatedAt: true,
  _count: {
    select: {
      documents: { where: { deletedAt: null } },
      /** Its shared account, unless deactivated (at most one: a unique index). */
      accounts: { where: { disabledAt: null } },
    },
  },
} satisfies Prisma.OrganizationSelect;

export type AdminOrgRecord = Prisma.OrganizationGetPayload<{
  select: typeof ADMIN_ORG_SELECT;
}>;

const collegeFields = {
  id: true,
  code: true,
  slug: true,
  name: true,
  motto: true,
  description: true,
  position: true,
} satisfies Prisma.CollegeSelect;

export type AdminCollegeRecord = Prisma.CollegeGetPayload<{ select: typeof collegeFields }>;

const ORDER = [
  { position: 'asc' },
  { name: 'asc' },
] satisfies Prisma.OrganizationOrderByWithRelationInput[];

export interface NewOrganization {
  type: Extract<OrganizationType, 'CSC' | 'SBO'>;
  slug: string;
  acronym: string;
  name: string;
  description?: string;
  collegeId: string;
  parentId: string;
}

/**
 * Colleges and organizations as admins manage them: deactivated ones included, deleted ones
 * never. Only the admin services use this; public reads go through the college and
 * organization repositories.
 */
export function createAdminOrganizationRepository(db: Db) {
  return {
    async tree(): Promise<{
      issc: AdminOrgRecord | null;
      colleges: AdminCollegeRecord[];
      organizations: AdminOrgRecord[];
    }> {
      const [colleges, organizations] = await Promise.all([
        db.college.findMany({ orderBy: ORDER, select: collegeFields }),
        db.organization.findMany({
          where: { deletedAt: null },
          orderBy: ORDER,
          select: ADMIN_ORG_SELECT,
        }),
      ]);
      return {
        issc: organizations.find((org) => org.type === 'ISSC') ?? null,
        colleges,
        organizations: organizations.filter((org) => org.type !== 'ISSC'),
      };
    },

    findCollege(slug: string): Promise<AdminCollegeRecord | null> {
      return db.college.findUnique({ where: { slug }, select: collegeFields });
    },

    /** Unique by code or slug: null when either is taken. */
    async collegeTaken(code: string, slug: string, exceptId?: string): Promise<boolean> {
      const clash = await db.college.findFirst({
        where: {
          OR: [{ code: { equals: code, mode: 'insensitive' } }, { slug }],
          ...(exceptId && { id: { not: exceptId } }),
        },
        select: { id: true },
      });
      return clash !== null;
    },

    async createCollege(input: Prisma.CollegeCreateInput): Promise<AdminCollegeRecord> {
      const last = await db.college.aggregate({ _max: { position: true } });
      return db.college.create({
        data: { ...input, position: (last._max.position ?? -1) + 1 },
        select: collegeFields,
      });
    },

    updateCollege(id: string, patch: Prisma.CollegeUpdateInput): Promise<AdminCollegeRecord> {
      return db.college.update({ where: { id }, data: patch, select: collegeFields });
    },

    async collegeSlugs(): Promise<string[]> {
      const rows = await db.college.findMany({ select: { slug: true } });
      return rows.map((row) => row.slug);
    },

    /** Positions follow the order of `slugs`, which the service checked is complete. */
    async reorderColleges(slugs: string[]): Promise<void> {
      await db.$transaction(
        slugs.map((slug, position) => db.college.update({ where: { slug }, data: { position } })),
      );
    },

    findOrganization(slug: string): Promise<AdminOrgRecord | null> {
      return db.organization.findFirst({
        where: { slug, deletedAt: null },
        select: ADMIN_ORG_SELECT,
      });
    },

    /** Slugs are unique across organizations, deleted ones included (old links). */
    async organizationSlugTaken(slug: string): Promise<boolean> {
      return (await db.organization.count({ where: { slug } })) > 0;
    },

    /** The CSC of a college (deactivated or not), or null. */
    cscOf(collegeId: string): Promise<{ id: string } | null> {
      return db.organization.findFirst({
        where: { collegeId, type: 'CSC', deletedAt: null },
        select: { id: true },
      });
    },

    issc(): Promise<{ id: string } | null> {
      return db.organization.findFirst({
        where: { type: 'ISSC', deletedAt: null },
        select: { id: true },
      });
    },

    async createOrganization(input: NewOrganization): Promise<AdminOrgRecord> {
      const last = await db.organization.aggregate({
        where: { parentId: input.parentId, deletedAt: null },
        _max: { position: true },
      });
      return db.organization.create({
        data: { ...input, position: (last._max.position ?? -1) + 1 },
        select: ADMIN_ORG_SELECT,
      });
    },

    updateOrganization(id: string, patch: Prisma.OrganizationUpdateInput): Promise<AdminOrgRecord> {
      return db.organization.update({ where: { id }, data: patch, select: ADMIN_ORG_SELECT });
    },

    async sboSlugs(parentId: string): Promise<string[]> {
      const rows = await db.organization.findMany({
        where: { parentId, type: 'SBO', deletedAt: null },
        select: { slug: true },
      });
      return rows.map((row) => row.slug);
    },

    async reorderOrganizations(slugs: string[]): Promise<void> {
      await db.$transaction(
        slugs.map((slug, position) =>
          db.organization.update({ where: { slug }, data: { position } }),
        ),
      );
    },
  };
}

export type AdminOrganizationRepository = ReturnType<typeof createAdminOrganizationRepository>;
