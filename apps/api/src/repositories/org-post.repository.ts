import type { OrgPostStatus, OrgPostType } from '@orghive/shared';
import type { Prisma } from '#src/generated/prisma/client';
import type { Db } from './prisma';

const ownerSelect = {
  id: true,
  slug: true,
  type: true,
  parentId: true,
  acronym: true,
  name: true,
  logoKey: true,
} satisfies Prisma.OrganizationSelect;

const postSelect = {
  id: true,
  organizationId: true,
  type: true,
  title: true,
  slug: true,
  summary: true,
  body: true,
  coverKey: true,
  coverWidths: true,
  coverAlt: true,
  gallery: true,
  externalLink: true,
  eventDate: true,
  status: true,
  publishAt: true,
  publishedAt: true,
  editedAt: true,
  pinned: true,
  pinOrder: true,
  actingAs: true,
  hiddenAt: true,
  hiddenReason: true,
  updatedAt: true,
  organization: { select: ownerSelect },
} satisfies Prisma.OrgPostSelect;

export type OrgPostRecord = Prisma.OrgPostGetPayload<{ select: typeof postSelect }>;
export type PostOwner = OrgPostRecord['organization'];

/** The editable columns a create or an edit writes. */
export interface PostContentData {
  title: string;
  summary: string;
  body: string;
  coverKey: string | null;
  coverWidths: number[];
  coverAlt: string | null;
  gallery: Prisma.InputJsonValue;
  externalLink: string | null;
  eventDate: Date | null;
  actingAs: string;
}

/** Not deleted, of an organization that is not deleted. */
const kept: Prisma.OrgPostWhereInput = { deletedAt: null, organization: { deletedAt: null } };

/**
 * What everyone may see: published, or scheduled and due (post-rules.ts `isLive`, which this
 * mirrors; the worker flips due posts to PUBLISHED within a minute). The visibility filter
 * for public reads lives here and nowhere else.
 */
function live(now: Date): Prisma.OrgPostWhereInput {
  return {
    ...kept,
    OR: [{ status: 'PUBLISHED' }, { status: 'SCHEDULED', publishAt: { lte: now } }],
  };
}

/** The first and last instant of a Manila calendar year. */
function manilaYear(year: number): { gte: Date; lt: Date } {
  return {
    gte: new Date(`${year}-01-01T00:00:00+08:00`),
    lt: new Date(`${year + 1}-01-01T00:00:00+08:00`),
  };
}

/** Newest first; ties (same instant) by id, which is UUIDv7 and so also by time. */
const newestFirst: Prisma.OrgPostOrderByWithRelationInput[] = [
  { publishedAt: 'desc' },
  { id: 'desc' },
];

/**
 * Organization posts (docs/DOMAIN_RULES.md, "Organization posts"). Public reads see live
 * posts only; the organization's own account (checked by the route guard) sees every status.
 */
export function createOrgPostRepository(db: Db) {
  return {
    /** The organization behind a slug, as the post rules need it. Null when deleted. */
    findOwner(slug: string): Promise<PostOwner | null> {
      return db.organization.findFirst({ where: { slug, deletedAt: null }, select: ownerSelect });
    },

    /** One of the organization's own posts, any status. Null when deleted or another's. */
    findOwn(organizationId: string, id: string): Promise<OrgPostRecord | null> {
      return db.orgPost.findFirst({ where: { ...kept, id, organizationId }, select: postSelect });
    },

    /**
     * A post by its slug: live ones for everyone; with `includeOwn`, the organization's own
     * account also gets drafts, scheduled and hidden ones.
     */
    findBySlug(
      organizationId: string,
      slug: string,
      now: Date,
      includeOwn: boolean,
    ): Promise<OrgPostRecord | null> {
      return db.orgPost.findFirst({
        where: includeOwn
          ? { ...kept, organizationId, slug }
          : { ...live(now), organizationId, slug },
        select: postSelect,
      });
    },

    /** One page of live posts, newest first, optionally of one type and one Manila year. */
    async listLive(filters: {
      organizationId: string;
      type?: OrgPostType;
      year?: number;
      page: number;
      pageSize: number;
      now: Date;
    }): Promise<{ items: OrgPostRecord[]; total: number }> {
      const where: Prisma.OrgPostWhereInput = {
        ...live(filters.now),
        organizationId: filters.organizationId,
        type: filters.type,
        ...(filters.year !== undefined && { publishedAt: manilaYear(filters.year) }),
      };
      const [items, total] = await Promise.all([
        db.orgPost.findMany({
          where,
          orderBy: newestFirst,
          skip: (filters.page - 1) * filters.pageSize,
          take: filters.pageSize,
          select: postSelect,
        }),
        db.orgPost.count({ where }),
      ]);
      return { items, total };
    },

    /** Manila years that have live posts (of `type`, if given), newest first. */
    async liveYears(organizationId: string, now: Date, type?: OrgPostType): Promise<number[]> {
      const rows = await db.orgPost.findMany({
        where: { ...live(now), organizationId, type, publishedAt: { not: null } },
        select: { publishedAt: true },
        orderBy: { publishedAt: 'desc' },
      });
      const years = new Set<number>();
      for (const { publishedAt } of rows) {
        // Manila is UTC+8 all year (no daylight saving).
        years.add(new Date(publishedAt!.getTime() + 8 * 3_600_000).getUTCFullYear());
      }
      return [...years];
    },

    /** The carousel: pinned live highlights in pinned order. */
    pinnedHighlights(organizationId: string, now: Date): Promise<OrgPostRecord[]> {
      return db.orgPost.findMany({
        where: { ...live(now), organizationId, type: 'HIGHLIGHT', pinned: true },
        orderBy: { pinOrder: 'asc' },
        select: postSelect,
      });
    },

    /** The live posts just older and just newer than `post` (by publishedAt, then id). */
    async neighbours(
      post: Pick<OrgPostRecord, 'id' | 'organizationId' | 'publishedAt'>,
      now: Date,
    ): Promise<{ previous: OrgPostRecord | null; next: OrgPostRecord | null }> {
      if (!post.publishedAt) return { previous: null, next: null };
      const base = { ...live(now), organizationId: post.organizationId, id: { not: post.id } };
      const [previous, next] = await Promise.all([
        db.orgPost.findFirst({
          where: {
            ...base,
            AND: [
              {
                OR: [
                  { publishedAt: { lt: post.publishedAt } },
                  { publishedAt: post.publishedAt, id: { lt: post.id } },
                ],
              },
            ],
          },
          orderBy: newestFirst,
          select: postSelect,
        }),
        db.orgPost.findFirst({
          where: {
            ...base,
            AND: [
              {
                OR: [
                  { publishedAt: { gt: post.publishedAt } },
                  { publishedAt: post.publishedAt, id: { gt: post.id } },
                ],
              },
            ],
          },
          orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }],
          select: postSelect,
        }),
      ]);
      return { previous, next };
    },

    /** The own account's list: every status, newest change first. */
    async listOwn(filters: {
      organizationId: string;
      type?: OrgPostType;
      status?: OrgPostStatus;
      page: number;
      pageSize: number;
    }): Promise<{ items: OrgPostRecord[]; total: number; pinnedCount: number }> {
      const where: Prisma.OrgPostWhereInput = {
        ...kept,
        organizationId: filters.organizationId,
        type: filters.type,
        status: filters.status,
      };
      const [items, total, pinnedCount] = await Promise.all([
        db.orgPost.findMany({
          where,
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          skip: (filters.page - 1) * filters.pageSize,
          take: filters.pageSize,
          select: postSelect,
        }),
        db.orgPost.count({ where }),
        db.orgPost.count({ where: { ...kept, organizationId: filters.organizationId, pinned: true } }),
      ]);
      return { items, total, pinnedCount };
    },

    /** The organization's highlights by id (any status), for a pin request. */
    findOwnHighlights(organizationId: string, ids: readonly string[]): Promise<OrgPostRecord[]> {
      return db.orgPost.findMany({
        where: { ...kept, organizationId, id: { in: [...ids] } },
        select: postSelect,
      });
    },

    /** Every slug of the organization that starts with `base`, deleted posts included. */
    async slugsLike(organizationId: string, base: string): Promise<Set<string>> {
      const rows = await db.orgPost.findMany({
        where: { organizationId, slug: { startsWith: base } },
        select: { slug: true },
      });
      return new Set(rows.map((r) => r.slug));
    },

    create(input: PostContentData & {
      organizationId: string;
      createdById: string;
      type: OrgPostType;
      slug: string;
      status: OrgPostStatus;
      publishAt: Date | null;
      publishedAt: Date | null;
    }): Promise<OrgPostRecord> {
      return db.orgPost.create({ data: input, select: postSelect });
    },

    /** Writes `data`; a post that may no longer be pinned (`unpin`) loses its place. */
    update(
      id: string,
      data: Partial<PostContentData> & {
        status?: OrgPostStatus;
        publishAt?: Date | null;
        publishedAt?: Date | null;
        editedAt?: Date | null;
        hiddenAt?: Date | null;
        hiddenReason?: string | null;
        hiddenByOrgId?: string | null;
        actingAs: string;
      },
      unpin = false,
    ): Promise<OrgPostRecord> {
      return db.orgPost.update({
        where: { id },
        data: { ...data, ...(unpin && { pinned: false, pinOrder: null }) },
        select: postSelect,
      });
    },

    /**
     * Replaces the organization's pinned set with `plan`, in one transaction: everything is
     * unpinned first, so the unique (organization, place) index never sees two at once.
     */
    async setPins(
      organizationId: string,
      plan: readonly { id: string; pinOrder: number }[],
      actingAs: string,
    ): Promise<void> {
      await db.$transaction([
        db.orgPost.updateMany({
          where: { organizationId, pinned: true },
          data: { pinned: false, pinOrder: null },
        }),
        ...plan.map(({ id, pinOrder }) =>
          db.orgPost.update({
            where: { id, organizationId },
            data: { pinned: true, pinOrder, actingAs },
          }),
        ),
      ]);
    },

    /** Soft delete, losing its pin. False when it was already deleted. */
    async softDelete(organizationId: string, id: string, at: Date, actingAs: string) {
      const { count } = await db.orgPost.updateMany({
        where: { id, organizationId, deletedAt: null },
        data: { deletedAt: at, pinned: false, pinOrder: null, actingAs },
      });
      return count > 0;
    },

    /**
     * Flips scheduled posts whose time has come to PUBLISHED. Returns the slugs of the
     * organizations it touched (for cache clearing). Idempotent.
     */
    async publishDue(now: Date): Promise<string[]> {
      const due = await db.orgPost.findMany({
        where: { ...kept, status: 'SCHEDULED', publishAt: { lte: now } },
        select: { id: true, organization: { select: { slug: true } } },
      });
      if (due.length === 0) return [];
      await db.orgPost.updateMany({
        where: { id: { in: due.map((d) => d.id) }, status: 'SCHEDULED' },
        data: { status: 'PUBLISHED' },
      });
      return [...new Set(due.map((d) => d.organization.slug))];
    },

    /** Removes the demo posts (db:unseed:demo). */
    deleteDemo(): Promise<Prisma.BatchPayload> {
      return db.orgPost.deleteMany({ where: { isDemo: true } });
    },
  };
}

export type OrgPostRepository = ReturnType<typeof createOrgPostRepository>;
