import { createHash } from 'node:crypto';
import {
  ANNOUNCEMENT_POSTER_TYPES,
  paragraphsOf,
  type Announcement,
  type AnnouncementListQuery,
  type AnnouncementListResponse,
  type CreateAnnouncementRequest,
  type UpdateAnnouncementRequest,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import type { Cache } from '#src/lib/cache';
import type {
  AnnouncementRecord,
  AnnouncementRepository,
} from '#src/repositories/announcement.repository';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { AccountRepository } from '#src/repositories/account.repository';
import type { OrganizationRepository } from '#src/repositories/organization.repository';
import type { Logger } from '#src/logger';
import type { OrgRef } from '#src/services/access.service';
import type { Actor } from '#src/services/document.service';
import type { NotificationService } from '#src/services/notification.service';

/** Signed-out update lists are cached this long; any write clears them. */
export const ANNOUNCEMENT_LIST_TTL_SECONDS = 5 * 60;
const LIST_PATTERN = 'updates:*';
const DEFAULT_LIMIT = 10;

export interface AnnouncementServiceDeps {
  announcements: AnnouncementRepository;
  organizations: Pick<OrganizationRepository, 'findBySlug'>;
  accounts: Pick<AccountRepository, 'findAccount' | 'findAccountIdsUnder'>;
  audit: Pick<AuditLogRepository, 'record'>;
  cache: Pick<Cache, 'getOrSet' | 'deleteMatching'>;
  /** Tells the council's members about a new update (docs/DOMAIN_RULES.md, "Notifications"). */
  notifications?: Pick<NotificationService, 'notify'>;
  logger?: Pick<Logger, 'warn'>;
  now?: () => Date;
}

/** How much of an update's opening the notification quotes. */
const NOTICE_EXCERPT_CHARS = 280;

function excerpt(body: string): string {
  const first = (paragraphsOf(body)[0] ?? '').replace(/\s+/g, ' ');
  return first.length > NOTICE_EXCERPT_CHARS
    ? `${first.slice(0, NOTICE_EXCERPT_CHARS - 1).trimEnd()}…`
    : first;
}

const POSTERS: readonly string[] = ANNOUNCEMENT_POSTER_TYPES;

function hashOf(query: AnnouncementListQuery): string {
  const sorted = Object.entries(query)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 32);
}

/**
 * Updates (announcements), docs/DOMAIN_RULES.md: ISSC and CSC officers post, anyone reads,
 * posting publishes at once, and the posting council's officers edit or delete. The route
 * guard checks the officer role; this service checks that the council may post at all.
 */
export function createAnnouncementService({
  announcements,
  organizations,
  accounts,
  audit,
  cache,
  notifications,
  logger,
  now = () => new Date(),
}: AnnouncementServiceDeps) {
  /**
   * A CSC's update reaches the active members of the CSC and of its college's SBOs; the
   * ISSC's reaches everyone with an active membership. Not the author. Never fails the post:
   * the update is already published, so a failure here is only logged.
   */
  async function tellMembers(
    council: { id: string; type: string; acronym: string },
    record: { id: string; title: string; body: string },
    authorId: string,
  ) {
    if (!notifications) return;
    try {
      const members = await accounts.findAccountIdsUnder(
        council.type === 'ISSC' ? 'everyone' : { councilId: council.id },
      );
      const userIds = members.filter((id) => id !== authorId);
      if (userIds.length === 0) return;
      await notifications.notify({
        userIds,
        kind: 'announcement_posted',
        title: `${council.acronym}: ${record.title}`,
        body: excerpt(record.body),
        link: `/updates/${record.id}`,
        dedupeKey: `announcement:${record.id}`,
      });
    } catch (err) {
      logger?.warn({ err, announcementId: record.id }, 'Could not notify members of an update');
    }
  }

  /** The council (ISSC or a CSC) the account posts for: its own, if it is one. */
  async function officerCouncils(userId: string | undefined) {
    if (!userId) return [];
    const account = await accounts.findAccount(userId);
    return account && POSTERS.includes(account.organization.type) ? [account.organization] : [];
  }

  function present(record: AnnouncementRecord, editable: ReadonlySet<string>): Announcement {
    return {
      id: record.id,
      title: record.title,
      body: record.body,
      publishedAt: record.publishedAt!.toISOString(),
      editedAt: record.editedAt?.toISOString() ?? null,
      organization: {
        type: record.organization.type,
        slug: record.organization.slug,
        acronym: record.organization.acronym,
        name: record.organization.name,
      },
      canEdit: editable.has(record.organization.id),
    };
  }

  async function invalidate() {
    await cache.deleteMatching(LIST_PATTERN);
  }

  return {
    /**
     * Newest first, optionally one council's. Signed-out lists are cached; a signed-in
     * user also learns which councils they may post for and which updates they may edit.
     */
    async list(
      userId: string | undefined,
      query: AnnouncementListQuery,
    ): Promise<AnnouncementListResponse> {
      let organizationId: string | undefined;
      if (query.org) {
        const org = await organizations.findBySlug(query.org);
        if (!org) throw AppError.notFound('Organization not found');
        organizationId = org.id;
      }
      const load = () =>
        announcements.list({
          organizationId,
          cursor: query.cursor,
          limit: query.limit ?? DEFAULT_LIMIT,
        });
      const page = userId
        ? await load()
        : (await cache.getOrSet(`updates:${hashOf(query)}`, ANNOUNCEMENT_LIST_TTL_SECONDS, load))!;

      // The cache holds JSON: dates come back as strings.
      const items = page.items.map((item) => ({
        ...item,
        publishedAt: item.publishedAt && new Date(item.publishedAt),
        editedAt: item.editedAt && new Date(item.editedAt),
      }));
      const councils = await officerCouncils(userId);
      const editable = new Set(councils.map((c) => c.id));
      return {
        items: items.map((item) => present(item, editable)),
        nextCursor: page.nextCursor,
        canPostFor: councils.map(({ type, slug, acronym, name }) => ({
          type,
          slug,
          acronym,
          name,
        })),
      };
    },

    /** 404 for an unknown or deleted update. */
    async get(userId: string | undefined, id: string): Promise<Announcement> {
      const record = await announcements.findById(id);
      if (!record) throw AppError.notFound('Update not found');
      const editable = new Set((await officerCouncils(userId)).map((c) => c.id));
      return present(record, editable);
    },

    /** Only the ISSC and CSCs post updates (403 for an SBO). Published at once. */
    async create(
      actor: Actor,
      org: OrgRef,
      input: CreateAnnouncementRequest,
    ): Promise<Announcement> {
      const found = await organizations.findBySlug(org.slug);
      if (!found || !POSTERS.includes(found.type)) {
        throw AppError.forbidden('Only the ISSC and the CSCs post updates');
      }
      const record = await announcements.create({
        organizationId: org.id,
        authorId: actor.userId,
        title: input.title,
        body: input.body,
        publishedAt: now(),
      });
      await audit.record({
        action: 'announcement_change',
        actorId: actor.userId,
        entityType: 'announcement',
        entityId: record.id,
        organizationId: org.id,
        metadata: { change: 'publish' },
        ip: actor.ip,
      });
      await invalidate();
      await tellMembers(
        { id: org.id, type: found.type, acronym: found.acronym },
        record,
        actor.userId,
      );
      return present(record, new Set([org.id]));
    },

    async update(
      actor: Actor,
      org: OrgRef,
      id: string,
      patch: UpdateAnnouncementRequest,
    ): Promise<Announcement> {
      const record = await announcements.update(id, patch, now());
      await audit.record({
        action: 'announcement_change',
        actorId: actor.userId,
        entityType: 'announcement',
        entityId: id,
        organizationId: org.id,
        metadata: { change: 'edit', fields: Object.keys(patch) },
        ip: actor.ip,
      });
      await invalidate();
      return present(record, new Set([org.id]));
    },

    /** Soft delete. 404 when it was already deleted. */
    async remove(actor: Actor, org: OrgRef, id: string): Promise<void> {
      if (!(await announcements.softDelete(id, now()))) throw AppError.notFound('Update not found');
      await audit.record({
        action: 'delete',
        actorId: actor.userId,
        entityType: 'announcement',
        entityId: id,
        organizationId: org.id,
        ip: actor.ip,
      });
      await invalidate();
    },
  };
}

export type AnnouncementService = ReturnType<typeof createAnnouncementService>;
