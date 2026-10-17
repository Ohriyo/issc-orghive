import type { NotificationKind, NotificationListResponse } from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import type { Mailer } from '#src/lib/mailer';
import type { NotificationQueue } from '#src/lib/queue';
import type { Logger } from '#src/logger';
import type { NotificationRepository } from '#src/repositories/notification.repository';

/** How many notifications the bell lists. */
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
 * In-app notifications; the worker emails each one once (`sendEmail`). Sending never fails
 * the action that caused it: an email that could not be queued is logged, and the in-app
 * notification is still there.
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
      const ids = await notifications.createMany(
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
        await queue.enqueueEmails(ids);
      } catch (err) {
        logger.warn(
          { err, kind: input.kind, count: ids.length },
          'Could not queue notification emails',
        );
      }
    },

    async list(userId: string): Promise<NotificationListResponse> {
      const [items, unreadCount] = await Promise.all([
        notifications.listForUser(userId, NOTIFICATION_LIST_SIZE),
        notifications.countUnread(userId),
      ]);
      return {
        unreadCount,
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
  notifications: Pick<NotificationRepository, 'findForEmail' | 'markEmailed'>;
  mailer: Mailer;
  webOrigin: string;
  now?: () => Date;
}) {
  return {
    async sendEmail(notificationId: string): Promise<'sent' | 'skipped'> {
      const n = await notifications.findForEmail(notificationId);
      if (!n) return 'skipped';
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
