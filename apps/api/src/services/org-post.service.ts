import { createHash } from 'node:crypto';
import {
  ErrorCode,
  PAGE_RECENT_UPDATES,
  POSTS_PAGE_SIZE,
  postImageSlugOf,
  postSlugFromTitle,
  type CreatePostInput,
  type HidePostRequest,
  type ManagedPost,
  type ManagedPostListResponse,
  type ManagePostListQuery,
  type OrganizationPage,
  type PostCard,
  type PostDetail,
  type PostImage,
  type PostImageInput,
  type PostListQuery,
  type PostListResponse,
  type PostViewer,
  type UpdatePostInput,
  type UploadedPostImage,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { cacheKeys, type Cache } from '#src/lib/cache';
import type { VirusScanner } from '#src/lib/clamav';
import { LOGO_CACHE_CONTROL, LogoRejectedError, processPostImage } from '#src/lib/logo';
import { renderPostBody } from '#src/lib/markdown';
import { logoSrcSet, type PublicUrl } from '#src/lib/public-url';
import type { Storage } from '#src/lib/storage';
import type { Logger } from '#src/logger';
import type { AccountRepository } from '#src/repositories/account.repository';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type {
  OrgPostRecord,
  OrgPostRepository,
  PostContentData,
  PostOwner,
} from '#src/repositories/org-post.repository';
import type { OrgRef } from '#src/services/access.service';
import type { Actor } from '#src/services/document.service';
import type { NotificationService } from '#src/services/notification.service';
import type { OrganizationService } from '#src/services/organization.service';
import {
  isLive,
  assertCanHide,
  assertCanUnpublish,
  keepsPin,
  moderationAuthority,
  planPins,
  PostRuleViolation,
  statusAfterPublish,
  uniqueSlug,
  type PostRuleError,
} from '#src/services/post-rules';
import type { Recipients } from '#src/services/recipients.service';

/** Public post reads are cached this long; every post or profile change clears them. */
export const POST_CACHE_TTL_SECONDS = 10 * 60;

/**
 * The worker's every-minute job (queue `document-processing`, `publish-due-posts`):
 * scheduled posts whose time has come go live, and their organizations' cached reads are
 * cleared. Idempotent. Public reads already treat due posts as live (post-rules.ts `isLive`).
 */
export function createScheduledPostPublisher({
  posts,
  cache,
  now = () => new Date(),
}: {
  posts: Pick<OrgPostRepository, 'publishDue'>;
  cache: Pick<Cache, 'deleteMatching'>;
  now?: () => Date;
}) {
  return async function publishDue(): Promise<number> {
    const slugs = await posts.publishDue(now());
    for (const slug of slugs) await cache.deleteMatching(cacheKeys.organizationPostsPattern(slug));
    return slugs.length;
  };
}

export interface OrgPostServiceDeps {
  posts: OrgPostRepository;
  organizations: Pick<OrganizationService, 'getBySlug'>;
  accounts: Pick<AccountRepository, 'findAccount'>;
  recipients: Pick<Recipients, 'decidersOf' | 'officersOf'>;
  notifications: Pick<NotificationService, 'notify'>;
  audit: Pick<AuditLogRepository, 'record'>;
  cache: Pick<Cache, 'getOrSet' | 'deleteMatching'>;
  storage: Pick<Storage, 'put'>;
  scanner: VirusScanner;
  publicUrl: PublicUrl;
  logger?: Pick<Logger, 'warn'>;
  now?: () => Date;
}

const RULE_MESSAGES: Record<PostRuleError, string> = {
  SCHEDULE_IN_PAST: 'Choose a time in the future, or publish now',
  ALREADY_PUBLISHED: 'This post is already published',
  NOT_PUBLISHED: 'Only a published or scheduled post can be unpublished',
  NOT_LIVE: 'Only a published post can be hidden',
  NOT_A_HIGHLIGHT: 'Pin published or scheduled highlights only',
  TOO_MANY_PINNED: 'Pin up to 6 highlights',
  UNKNOWN_POST: 'One of these posts no longer exists',
};

/** Runs a post rule, turning a violation into the 409 (or 400) the form can show. */
function rule<T>(run: () => T): T {
  try {
    return run();
  } catch (err) {
    if (err instanceof PostRuleViolation) {
      const message = RULE_MESSAGES[err.code];
      if (err.code === 'SCHEDULE_IN_PAST') {
        throw new AppError(400, ErrorCode.VALIDATION_ERROR, `publishAt: ${message}`);
      }
      throw AppError.conflict(message);
    }
    throw err;
  }
}

/** A stored gallery entry; anything else in the JSON is ignored. */
function galleryOf(value: unknown): PostImageInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const { key, widths, alt } = item as Record<string, unknown>;
    if (typeof key !== 'string' || typeof alt !== 'string' || !Array.isArray(widths)) return [];
    const sizes = widths.filter((w): w is number => typeof w === 'number');
    return [{ key, alt, widths: sizes as PostImageInput['widths'] }];
  });
}

function hashOf(value: object): string {
  const sorted = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 32);
}

/** A Date column with no time (`@db.Date`) as YYYY-MM-DD, and back. */
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const dayOf = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

/**
 * Organization posts (docs/DOMAIN_RULES.md, "Organization posts"; rules in post-rules.ts).
 * The organization's own account writes (the route guard checks requireOwnOrg); its
 * governing body may hide; everyone reads live posts. Every write is audited with who acted
 * for the account and clears the organization's cached post reads.
 */
export function createOrgPostService({
  posts,
  organizations,
  accounts,
  recipients,
  notifications,
  audit,
  cache,
  storage,
  scanner,
  publicUrl,
  logger,
  now = () => new Date(),
}: OrgPostServiceDeps) {
  function image(key: string | null, widths: readonly number[], alt: string | null): PostImage | null {
    const url = publicUrl(key);
    if (!url) return null;
    return { url, srcSet: logoSrcSet(publicUrl, key, widths), alt: alt ?? '' };
  }

  function toCard(record: OrgPostRecord): PostCard {
    return {
      id: record.id,
      slug: record.slug,
      type: record.type,
      title: record.title,
      summary: record.summary,
      eventDate: isoDay(record.eventDate),
      // A due scheduled post the worker has not flipped yet went live at publishAt.
      publishedAt: iso(record.publishedAt ?? record.publishAt)!,
      cover: image(record.coverKey, record.coverWidths, record.coverAlt),
      externalLink: record.externalLink,
    };
  }

  function toManaged(record: OrgPostRecord): ManagedPost {
    const withUrl = (img: PostImageInput) => ({ ...img, url: publicUrl(img.key) ?? '' });
    return {
      id: record.id,
      slug: record.slug,
      type: record.type,
      status: record.status,
      title: record.title,
      summary: record.summary,
      body: record.body,
      cover:
        record.coverKey && publicUrl(record.coverKey)
          ? withUrl({
              key: record.coverKey,
              widths: record.coverWidths as PostImageInput['widths'],
              alt: record.coverAlt ?? '',
            })
          : null,
      gallery: galleryOf(record.gallery).map(withUrl),
      externalLink: record.externalLink,
      eventDate: isoDay(record.eventDate),
      publishAt: iso(record.publishAt),
      publishedAt: iso(record.publishedAt),
      pinned: record.pinned,
      pinOrder: record.pinOrder,
      moderation:
        record.status === 'HIDDEN' && record.hiddenAt
          ? { hiddenAt: record.hiddenAt.toISOString(), reason: record.hiddenReason ?? '' }
          : null,
      actingAs: record.actingAs,
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  async function owner(slug: string): Promise<PostOwner> {
    const found = await posts.findOwner(slug);
    if (!found) throw AppError.notFound('Organization not found');
    return found;
  }

  /** Whether the viewer is the organization's own account, or may hide its posts. */
  async function viewerOf(userId: string | undefined, org: PostOwner): Promise<PostViewer> {
    if (!userId) return { isOwner: false, canModerate: false };
    const account = await accounts.findAccount(userId);
    const actorOrg = account?.organization ?? null;
    if (actorOrg?.id === org.id) return { isOwner: true, canModerate: false };
    return { isOwner: false, canModerate: (await authorityOver(actorOrg, org)) !== null };
  }

  /** post-rules.ts `moderationAuthority`; the seat check runs only for the ISSC. */
  async function authorityOver(
    actorOrg: { id: string; type: PostOwner['type'] } | null,
    org: PostOwner,
  ) {
    const owned = { id: org.id, type: org.type, parentId: org.parentId };
    const seated = moderationAuthority(owned, actorOrg, false);
    if (seated || actorOrg?.type !== 'ISSC') return seated;
    const { seatFilled } = await recipients.decidersOf(owned);
    return moderationAuthority(owned, actorOrg, !seatFilled);
  }

  async function invalidate(slug: string) {
    await cache.deleteMatching(cacheKeys.organizationPostsPattern(slug));
  }

  function record(
    actor: Actor,
    orgId: string,
    postId: string,
    change: string,
    actingAs: string,
    details: Record<string, unknown> = {},
  ) {
    return audit.record({
      action: change === 'delete' ? 'delete' : 'post_change',
      actorId: actor.userId,
      entityType: 'org_post',
      entityId: postId,
      organizationId: orgId,
      metadata: { change, ...details },
      ip: actor.ip,
      actingAs,
    });
  }

  /** Images must be this organization's uploads: a key names its organization. */
  function assertOwnImages(org: OrgRef, input: { cover: PostImageInput | null; gallery: PostImageInput[] }) {
    const images = [...(input.cover ? [input.cover] : []), ...input.gallery];
    for (const img of images) {
      if (postImageSlugOf(img.key) !== org.slug) {
        throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'images: Upload the image again');
      }
    }
  }

  function contentOf(input: UpdatePostInput): PostContentData {
    return {
      title: input.title,
      summary: input.summary,
      body: input.body,
      coverKey: input.cover?.key ?? null,
      coverWidths: input.cover ? [...input.cover.widths] : [],
      coverAlt: input.cover?.alt ?? null,
      gallery: input.gallery.map(({ key, widths, alt }) => ({ key, widths: [...widths], alt })),
      externalLink: input.externalLink,
      eventDate: dayOf(input.eventDate),
      actingAs: input.actingAs,
    };
  }

  async function loadOwn(org: OrgRef, postId: string): Promise<OrgPostRecord> {
    const found = await posts.findOwn(org.id, postId);
    if (!found) throw AppError.notFound('Post not found');
    return found;
  }

  /** The live sections of the page; the same for every viewer, so cached. */
  async function pageSections(org: PostOwner) {
    const at = now();
    const [highlights, recent] = await Promise.all([
      posts.pinnedHighlights(org.id, at),
      posts.listLive({ organizationId: org.id, type: 'UPDATE', page: 1, pageSize: PAGE_RECENT_UPDATES, now: at }),
    ]);
    return {
      highlights: highlights.map(toCard),
      updates: recent.items.map(toCard),
      updatesTotal: recent.total,
    };
  }

  return {
    /** GET /organizations/:slug/page: the header (cached by its own key) and the sections. */
    async page(userId: string | undefined, slug: string): Promise<OrganizationPage> {
      const org = await owner(slug);
      const [organization, sections, viewer] = await Promise.all([
        organizations.getBySlug(slug),
        cache.getOrSet(cacheKeys.organizationPostPage(slug), POST_CACHE_TTL_SECONDS, () => pageSections(org)),
        viewerOf(userId, org),
      ]);
      return { organization, ...sections!, viewer };
    },

    /** GET /organizations/:slug/posts: live posts, newest first. */
    async list(slug: string, query: PostListQuery): Promise<PostListResponse> {
      const org = await owner(slug);
      const load = async (): Promise<PostListResponse> => {
        const at = now();
        const [page, years] = await Promise.all([
          posts.listLive({
            organizationId: org.id,
            type: query.type,
            year: query.year,
            page: query.page,
            pageSize: POSTS_PAGE_SIZE,
            now: at,
          }),
          posts.liveYears(org.id, at, query.type),
        ]);
        return {
          items: page.items.map(toCard),
          page: query.page,
          pageSize: POSTS_PAGE_SIZE,
          total: page.total,
          years,
        };
      };
      return (await cache.getOrSet(
        cacheKeys.organizationPosts(slug, hashOf(query)),
        POST_CACHE_TTL_SECONDS,
        load,
      ))!;
    },

    /**
     * GET /organizations/:slug/posts/:postSlug. Everyone gets live posts; the organization's
     * own account also gets its drafts, scheduled and hidden posts, with why one was hidden.
     */
    async get(userId: string | undefined, slug: string, postSlug: string): Promise<PostDetail> {
      const org = await owner(slug);
      const viewer = await viewerOf(userId, org);
      const load = async (): Promise<Omit<PostDetail, 'viewer'> | null> => {
        const at = now();
        const found = await posts.findBySlug(org.id, postSlug, at, viewer.isOwner);
        if (!found) return null;
        const { previous, next } = await posts.neighbours(found, at);
        const hidden = found.status === 'HIDDEN' && found.hiddenAt;
        return {
          ...toCard(found),
          status: isLive(found, at) ? 'PUBLISHED' : found.status,
          publishedAt: iso(found.publishedAt ?? found.publishAt ?? found.updatedAt)!,
          bodyHtml: renderPostBody(found.body),
          gallery: galleryOf(found.gallery).flatMap((g) => image(g.key, g.widths, g.alt) ?? []),
          editedAt: iso(found.editedAt),
          previous: previous && { slug: previous.slug, title: previous.title },
          next: next && { slug: next.slug, title: next.title },
          organization: {
            slug: org.slug,
            acronym: org.acronym,
            name: org.name,
            logoUrl: publicUrl(org.logoKey),
          },
          moderation: hidden
            ? { hiddenAt: found.hiddenAt!.toISOString(), reason: found.hiddenReason ?? '' }
            : null,
        };
      };
      // The owner's view includes unpublished posts: never cache it with the public one.
      const detail = viewer.isOwner
        ? await load()
        : await cache.getOrSet(cacheKeys.organizationPost(slug, postSlug), POST_CACHE_TTL_SECONDS, load);
      if (!detail) throw AppError.notFound('Post not found');
      return { ...detail, viewer };
    },

    /** The own account's list: every status (requireOwnOrg). */
    async listOwn(org: OrgRef, query: ManagePostListQuery): Promise<ManagedPostListResponse> {
      const result = await posts.listOwn({
        organizationId: org.id,
        type: query.type,
        status: query.status,
        page: query.page,
        pageSize: POSTS_PAGE_SIZE,
      });
      return {
        items: result.items.map(toManaged),
        page: query.page,
        pageSize: POSTS_PAGE_SIZE,
        total: result.total,
        pinnedCount: result.pinnedCount,
      };
    },

    async getOwn(org: OrgRef, postId: string): Promise<ManagedPost> {
      return toManaged(await loadOwn(org, postId));
    },

    /**
     * POST /organizations/:slug/post-images: scans the bytes, then stores them as WebP
     * (metadata stripped) under the public, unguessable `logos/posts/<slug>/` prefix.
     */
    async uploadImage(
      actor: Actor,
      org: OrgRef,
      body: Buffer,
      actingAs: string,
    ): Promise<UploadedPostImage> {
      const scan = await scanner.scan(body);
      if (!scan.clean) {
        await audit.record({
          action: 'quarantine',
          actorId: actor.userId,
          entityType: 'org_post_image',
          entityId: org.id,
          organizationId: org.id,
          metadata: { signature: scan.signature },
          ip: actor.ip,
          actingAs,
        });
        throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'image: This file failed the virus scan');
      }
      let processed;
      try {
        processed = await processPostImage(org.slug, body);
      } catch (err) {
        const message = err instanceof LogoRejectedError ? err.message : 'This image could not be read';
        throw new AppError(400, ErrorCode.VALIDATION_ERROR, `image: ${message}`);
      }
      for (const file of processed.files) {
        await storage.put(file.key, file.body, 'image/webp', LOGO_CACHE_CONTROL);
      }
      await audit.record({
        action: 'upload',
        actorId: actor.userId,
        entityType: 'org_post_image',
        entityId: org.id,
        organizationId: org.id,
        metadata: { key: processed.key },
        ip: actor.ip,
        actingAs,
      });
      return { key: processed.key, widths: processed.widths, url: publicUrl(processed.key)! };
    },

    /** Saves a new post as a draft, publishes it now, or schedules it. */
    async create(actor: Actor, org: OrgRef, input: CreatePostInput): Promise<ManagedPost> {
      assertOwnImages(org, input);
      const at = now();
      const state =
        input.action === 'draft'
          ? { status: 'DRAFT' as const, publishAt: null }
          : rule(() =>
              statusAfterPublish(
                null,
                input.action === 'schedule' ? new Date(input.publishAt!) : null,
                at,
              ),
            );
      const base = postSlugFromTitle(input.title);
      const slug = uniqueSlug(base, await posts.slugsLike(org.id, base));
      const created = await posts.create({
        ...contentOf(input),
        organizationId: org.id,
        createdById: actor.userId,
        type: input.type,
        slug,
        status: state.status,
        publishAt: state.publishAt,
        publishedAt:
          state.status === 'PUBLISHED' ? at : state.status === 'SCHEDULED' ? state.publishAt : null,
      });
      await record(actor, org.id, created.id, input.action === 'draft' ? 'create' : input.action, input.actingAs, {
        type: input.type,
      });
      await invalidate(org.slug);
      return toManaged(created);
    },

    /** Saves the form again; the status stays. A live post records that it was edited. */
    async update(actor: Actor, org: OrgRef, postId: string, input: UpdatePostInput): Promise<ManagedPost> {
      assertOwnImages(org, input);
      const current = await loadOwn(org, postId);
      const wasLive = current.publishedAt !== null && current.status === 'PUBLISHED';
      const saved = await posts.update(postId, {
        ...contentOf(input),
        ...(wasLive && { editedAt: now() }),
      });
      await record(actor, org.id, postId, 'edit', input.actingAs);
      await invalidate(org.slug);
      return toManaged(saved);
    },

    /** Publishes now or at `publishAt`; also publishes a hidden post again. */
    async publish(
      actor: Actor,
      org: OrgRef,
      postId: string,
      input: { actingAs: string; publishAt: string | null },
    ): Promise<ManagedPost> {
      const current = await loadOwn(org, postId);
      const at = now();
      const next = rule(() =>
        statusAfterPublish(current.status, input.publishAt ? new Date(input.publishAt) : null, at),
      );
      const saved = await posts.update(postId, {
        status: next.status,
        publishAt: next.publishAt,
        publishedAt: next.status === 'SCHEDULED' ? next.publishAt : (current.publishedAt ?? at),
        hiddenAt: null,
        hiddenReason: null,
        hiddenByOrgId: null,
        actingAs: input.actingAs,
      });
      await record(
        actor,
        org.id,
        postId,
        current.status === 'HIDDEN' ? 'republish' : next.status === 'SCHEDULED' ? 'schedule' : 'publish',
        input.actingAs,
        next.publishAt ? { publishAt: next.publishAt.toISOString() } : {},
      );
      await invalidate(org.slug);
      return toManaged(saved);
    },

    /** Back to a draft: off the page, and off the carousel. */
    async unpublish(actor: Actor, org: OrgRef, postId: string, actingAs: string): Promise<ManagedPost> {
      const current = await loadOwn(org, postId);
      rule(() => assertCanUnpublish(current.status));
      const saved = await posts.update(
        postId,
        { status: 'DRAFT', publishAt: null, actingAs },
        !keepsPin(current.type, 'DRAFT'),
      );
      await record(actor, org.id, postId, 'unpublish', actingAs);
      await invalidate(org.slug);
      return toManaged(saved);
    },

    /** Soft delete. 404 when it was already deleted. */
    async remove(actor: Actor, org: OrgRef, postId: string, actingAs: string): Promise<void> {
      if (!(await posts.softDelete(org.id, postId, now(), actingAs))) {
        throw AppError.notFound('Post not found');
      }
      await record(actor, org.id, postId, 'delete', actingAs);
      await invalidate(org.slug);
    },

    /** Replaces the pinned highlights with `postIds`, in that order (up to 6). */
    async setPinned(actor: Actor, org: OrgRef, postIds: string[], actingAs: string): Promise<void> {
      const found = await posts.findOwnHighlights(org.id, postIds);
      const plan = rule(() => planPins(postIds, new Map(found.map((p) => [p.id, p]))));
      await posts.setPins(org.id, plan, actingAs);
      await audit.record({
        action: 'post_change',
        actorId: actor.userId,
        entityType: 'organization',
        entityId: org.id,
        organizationId: org.id,
        metadata: { change: 'pin', postIds },
        ip: actor.ip,
        actingAs,
      });
      await invalidate(org.slug);
    },

    /**
     * A governing body hides a live post, with a reason (moderation, not approval). The
     * organization is told why and may edit and publish it again.
     */
    async hide(actor: Actor, slug: string, postId: string, input: HidePostRequest): Promise<void> {
      const org = await owner(slug);
      const account = await accounts.findAccount(actor.userId);
      const authority = await authorityOver(account?.organization ?? null, org);
      if (!authority || !account) throw AppError.forbidden();
      const current = await loadOwn(org, postId);
      rule(() => assertCanHide(current, now()));
      const at = now();
      await posts.update(
        postId,
        {
          status: 'HIDDEN',
          hiddenAt: at,
          hiddenReason: input.reason,
          hiddenByOrgId: account.organization.id,
          actingAs: current.actingAs,
        },
        true,
      );
      await audit.record({
        action: 'post_change',
        actorId: actor.userId,
        entityType: 'org_post',
        entityId: postId,
        organizationId: org.id,
        metadata: { change: 'hide', reason: input.reason, authority, by: account.organization.id },
        ip: actor.ip,
        actingAs: input.actingAs,
      });
      if (authority === 'admin_override') {
        await audit.record({
          action: 'admin_override',
          actorId: actor.userId,
          entityType: 'org_post',
          entityId: postId,
          organizationId: org.id,
          metadata: { required: 'post_moderator', seat: 'vacant' },
          ip: actor.ip,
          actingAs: input.actingAs,
        });
      }
      await invalidate(org.slug);
      try {
        const userIds = await recipients.officersOf(org.id);
        if (userIds.length > 0) {
          await notifications.notify({
            userIds,
            kind: 'post_hidden',
            title: `${account.organization.acronym} hid “${current.title}”`,
            body: input.reason,
            link: `/dashboard/posts/${postId}`,
            dedupeKey: `post-hidden:${postId}:${at.toISOString()}`,
          });
        }
      } catch (err) {
        logger?.warn({ err, postId }, 'Could not tell the organization its post was hidden');
      }
    },

    /** See createScheduledPostPublisher (the worker runs it every minute). */
    publishDue: createScheduledPostPublisher({ posts, cache, now }),

    /** The newest live posts for the RSS feed (RSS is built by the controller). */
    async feed(slug: string) {
      const org = await owner(slug);
      const items = await cache.getOrSet(cacheKeys.organizationPostFeed(slug), POST_CACHE_TTL_SECONDS, async () => {
        const page = await posts.listLive({
          organizationId: org.id,
          page: 1,
          pageSize: 20,
          now: now(),
        });
        return page.items.map(toCard);
      });
      return { organization: { slug: org.slug, acronym: org.acronym, name: org.name }, items: items! };
    },

    /** For profile and admin changes: the page shows the header, so its sections go too. */
    invalidate,
  };
}

export type OrgPostService = ReturnType<typeof createOrgPostService>;
