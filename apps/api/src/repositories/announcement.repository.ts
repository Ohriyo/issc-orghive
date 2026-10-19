import type { Prisma } from '#src/generated/prisma/client';
import type { Db } from './prisma';

const announcementSelect = {
  id: true,
  title: true,
  body: true,
  publishedAt: true,
  editedAt: true,
  organization: { select: { id: true, type: true, slug: true, acronym: true, name: true } },
} satisfies Prisma.AnnouncementSelect;

export type AnnouncementRecord = Prisma.AnnouncementGetPayload<{
  select: typeof announcementSelect;
}>;

/** Published, not deleted, of an organization that is not deleted. */
const listed: Prisma.AnnouncementWhereInput = {
  publishedAt: { not: null },
  deletedAt: null,
  organization: { deletedAt: null },
};

/**
 * Updates are public once published (docs/DOMAIN_RULES.md), so reads need no viewer; only
 * deleted ones are hidden. Who may write is checked by the route guard and the service.
 */
export function createAnnouncementRepository(db: Db) {
  return {
    /** Newest first; ids are UUIDv7, so they sort by time. */
    async list(filters: {
      organizationId?: string;
      cursor?: string;
      limit: number;
    }): Promise<{ items: AnnouncementRecord[]; nextCursor: string | null }> {
      const items = await db.announcement.findMany({
        where: {
          ...listed,
          organizationId: filters.organizationId,
          ...(filters.cursor && { id: { lt: filters.cursor } }),
        },
        orderBy: { id: 'desc' },
        take: filters.limit + 1,
        select: announcementSelect,
      });
      const hasMore = items.length > filters.limit;
      const page = hasMore ? items.slice(0, filters.limit) : items;
      return { items: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
    },

    findById(id: string): Promise<AnnouncementRecord | null> {
      return db.announcement.findFirst({ where: { ...listed, id }, select: announcementSelect });
    },

    /** The posting organization, for the route guard. Null when deleted or unknown. */
    async organizationOf(id: string): Promise<{ id: string; slug: string } | null> {
      const row = await db.announcement.findFirst({
        where: { ...listed, id },
        select: { organization: { select: { id: true, slug: true } } },
      });
      return row?.organization ?? null;
    },

    /** Published at once: there are no drafts. */
    create(input: {
      organizationId: string;
      authorId: string;
      title: string;
      body: string;
      publishedAt: Date;
    }): Promise<AnnouncementRecord> {
      return db.announcement.create({ data: input, select: announcementSelect });
    },

    update(
      id: string,
      patch: { title?: string; body?: string },
      editedAt: Date,
    ): Promise<AnnouncementRecord> {
      return db.announcement.update({
        where: { id },
        data: { ...patch, editedAt },
        select: announcementSelect,
      });
    },

    async softDelete(id: string, at: Date): Promise<boolean> {
      const { count } = await db.announcement.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt: at },
      });
      return count > 0;
    },
  };
}

export type AnnouncementRepository = ReturnType<typeof createAnnouncementRepository>;
