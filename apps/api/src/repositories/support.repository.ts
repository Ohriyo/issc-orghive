import type { Db } from './prisma';

/*
 * File support for the /system console (docs/DOMAIN_RULES.md, "Accounts"). These reads see
 * every organization's documents, unlike document.repository's: they return details only,
 * never a storage key or a download, and the service hides private titles through
 * supportTitleOf (document-visibility.ts).
 */

const LATEST_VERSION = {
  orderBy: { version: 'desc' },
  take: 1,
  select: { id: true, sizeBytes: true, scanStatus: true, createdAt: true },
} as const;

/** How many documents one organization's support list shows, newest first. */
const SUPPORT_LIST_MAX = 200;
/** How many test-data files the preview lists (the total is always exact). */
const TEST_DATA_PREVIEW_MAX = 500;

export function createSupportRepository(db: Db) {
  return {
    findOrganization(slug: string) {
      return db.organization.findFirst({
        where: { slug, deletedAt: null },
        select: { id: true, slug: true, acronym: true, name: true },
      });
    },

    listDocuments(organizationId: string) {
      return db.document.findMany({
        where: { organizationId, deletedAt: null },
        orderBy: { id: 'desc' },
        take: SUPPORT_LIST_MAX,
        select: {
          id: true,
          title: true,
          status: true,
          visibility: true,
          isTestData: true,
          createdAt: true,
          updatedAt: true,
          type: { select: { name: true } },
          versions: LATEST_VERSION,
        },
      });
    },

    findDocument(id: string) {
      return db.document.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          status: true,
          organization: { select: { id: true, slug: true } },
          versions: LATEST_VERSION,
        },
      });
    },

    /** archived -> available, keeping its visibility. False if it was not archived. */
    async restore(id: string): Promise<boolean> {
      const { count } = await db.document.updateMany({
        where: { id, status: 'archived', deletedAt: null },
        data: { status: 'available' },
      });
      return count === 1;
    },

    async testDataPreview() {
      const where = { isTestData: true, deletedAt: null };
      const [items, total] = await db.$transaction([
        db.document.findMany({
          where,
          orderBy: { id: 'desc' },
          take: TEST_DATA_PREVIEW_MAX,
          select: {
            id: true,
            status: true,
            createdAt: true,
            type: { select: { name: true } },
            organization: { select: { slug: true, acronym: true } },
          },
        }),
        db.document.count({ where }),
      ]);
      return { items, total };
    },

    /**
     * Soft-deletes every test-data file, only if there are still exactly `expected` (what
     * the preview showed). Returns the deleted ones, or null when the count changed.
     */
    async deleteTestData(
      expected: number,
      at: Date,
    ): Promise<{ id: string; organizationId: string; slug: string }[] | null> {
      return db.$transaction(async (tx) => {
        const rows = await tx.document.findMany({
          where: { isTestData: true, deletedAt: null },
          select: { id: true, organizationId: true, organization: { select: { slug: true } } },
        });
        if (rows.length !== expected) return null;
        await tx.document.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { deletedAt: at },
        });
        return rows.map((r) => ({
          id: r.id,
          organizationId: r.organizationId,
          slug: r.organization.slug,
        }));
      });
    },
  };
}

export type SupportRepository = ReturnType<typeof createSupportRepository>;
