import {
  emailPreferences,
  type NotificationKind,
  type NotificationListQuery,
  type NotificationListResponse,
  type NotificationPreferences,
  type UpdateNotificationPreferences,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import type { Mailer } from '#src/lib/mailer';
import type { NotificationQueue } from '#src/lib/queue';
import type { Logger } from '#src/logger';
import type { NotificationRepository } from '#src/repositories/notification.repository';

/** How many notifications a page lists unless the caller asks for fewer. */
export const NOTIFICATION_LIST_SIZE = 30;

export interface NotifyInput {
  userIds: string[];
  kind: NotificationKind;
  title: string;
  body: string;
  /** An app path, e.g. "/projects/…". */
  link: string | null;
  /**
   * The event's key, e.g. "project-blocked:<id>:<due>". With it, notifying again about the
   * same event is skipped per user, so repeated checks are safe.
   */
  dedupeKey?: string;
}

export interface NotificationServiceDeps {
  notifications: NotificationRepository;
  queue: NotificationQueue;
  logger: Pick<Logger, 'warn'>;
  now?: () => Date;
}

/**
 * In-app notifications; the worker emails each one once (`sendEmail`), unless its user turned
 * email off for that kind. Sending never fails the action that caused it: an email that
 * could not be queued is logged, and the in-app notification is still there.
 */
export function createNotificationService({
  notifications,
  queue,
  logger,
  now = () => new Date(),
}: NotificationServiceDeps) {
  return {
    async notify(input: NotifyInput): Promise<void> {
      const userIds = [...new Set(input.userIds)];
      const created = await notifications.createMany(
        userIds.map((userId) => ({
          userId,
          kind: input.kind,
          title: input.title,
          body: input.body,
          link: input.link,
          dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${userId}` : null,
        })),
      );
      try {
        // Skipped up front for those who turned this kind off (an update can reach every
        // member); the worker checks again before sending, in case they change their mind.
        const optedOut = await notifications.optedOutOf(
          input.kind,
          created.map((n) => n.userId),
        );
        const ids = created.filter((n) => !optedOut.has(n.userId)).map((n) => n.id);
        await queue.enqueueEmails(ids);
      } catch (err) {
        logger.warn(
          { err, kind: input.kind, count: created.length },
          'Could not queue notification emails',
        );
      }
    },

    /** Newest first, a page at a time; `unread` lists only unread ones. */
    async list(
      userId: string,
      query: NotificationListQuery = {},
    ): Promise<NotificationListResponse> {
      const take = query.limit ?? NOTIFICATION_LIST_SIZE;
      if (query.cursor && !(await notifications.belongsTo(query.cursor, userId))) {
        throw AppError.notFound('Notification not found');
      }
      const [rows, unreadCount] = await Promise.all([
        notifications.listForUser(userId, {
          take,
          cursor: query.cursor,
          unreadOnly: query.unread ?? false,
        }),
        notifications.countUnread(userId),
      ]);
      const items = rows.slice(0, take);
      return {
        unreadCount,
        nextCursor: rows.length > take ? items.at(-1)!.id : null,
        items: items.map((n) => ({
          id: n.id,
          kind: n.kind,
          title: n.title,
          body: n.body,
          link: n.link,
          readAt: n.readAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
        })),
      };
    },

    /** 404 for someone else's notification. */
    async markRead(userId: string, id: string): Promise<void> {
      if (!(await notifications.markRead(id, userId, now()))) {
        throw AppError.notFound('Notification not found');
      }
    },

    async markAllRead(userId: string): Promise<void> {
      await notifications.markAllRead(userId, now());
    },

    /** Email on or off per kind; every kind is on until the user turns it off. */
    async preferences(userId: string): Promise<NotificationPreferences> {
      return { email: emailPreferences(await notifications.emailOptOuts(userId)) };
    },

    async updatePreferences(
      userId: string,
      input: UpdateNotificationPreferences,
    ): Promise<NotificationPreferences> {
      await notifications.setEmailPreferences(userId, input.email);
      return { email: emailPreferences(await notifications.emailOptOuts(userId)) };
    },
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/**
 * The worker's half: emails one notification. Idempotent: a notification already emailed
 * (or whose account is disabled) is skipped, so a retried job never sends twice.
 */
export function createNotificationMailer({
  notifications,
  mailer,
  webOrigin,
  now = () => new Date(),
}: {
  notifications: Pick<NotificationRepository, 'findForEmail' | 'markEmailed' | 'emailOptOuts'>;
  mailer: Mailer;
  webOrigin: string;
  now?: () => Date;
}) {
  return {
    async sendEmail(notificationId: string): Promise<'sent' | 'skipped'> {
      const n = await notifications.findForEmail(notificationId);
      if (!n) return 'skipped';
      // Checked at send time too: turning email off also stops emails already queued.
      if ((await notifications.emailOptOuts(n.userId)).includes(n.kind)) return 'skipped';
      const url = n.link ? new URL(n.link, webOrigin).toString() : null;
      await mailer.send({
        to: n.user.email,
        subject: `Orghive: ${n.title}`,
        text: [`Hi ${n.user.name},`, '', n.body, ...(url ? ['', url] : [])].join('\n'),
        html: [
          `<p>Hi ${escapeHtml(n.user.name)},</p>`,
          `<p>${escapeHtml(n.body)}</p>`,
          url ? `<p><a href="${escapeHtml(url)}">Open in Orghive</a></p>` : '',
        ].join(''),
      });
      await notifications.markEmailed(notificationId, now());
      return 'sent';
    },
  };
}
