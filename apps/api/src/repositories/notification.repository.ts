import type { NotificationKind, Prisma } from '#src/generated/prisma/client';
import type { Db } from './prisma';

const notificationSelect = {
  id: true,
  kind: true,
  title: true,
  body: true,
  link: true,
  revealId: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

export type NotificationRecord = Prisma.NotificationGetPayload<{
  select: typeof notificationSelect;
}>;

export interface NewNotification {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string | null;
  /** Unique per user and event; a second insert with the same key is skipped. */
  dedupeKey: string | null;
  /** The one-time Reveal it carries (password_reveal). */
  revealId?: string | null;
}

export function createNotificationRepository(db: Db) {
  return {
    /**
     * Inserts the notifications not already sent (by dedupe key). Returns the new ones, with
     * whom each is for.
     */
    async createMany(rows: NewNotification[]): Promise<{ id: string; userId: string }[]> {
      if (rows.length === 0) return [];
      return db.notification.createManyAndReturn({
        data: rows,
        skipDuplicates: true,
        select: { id: true, userId: true },
      });
    },

    /**
     * The user's notifications, newest first, from after `cursor` (an id from the last page).
     * Asks for one more than `take`, so the caller knows whether another page exists.
     */
    listForUser(
      userId: string,
      { take, cursor, unreadOnly = false }: { take: number; cursor?: string; unreadOnly?: boolean },
    ): Promise<NotificationRecord[]> {
      return db.notification.findMany({
        where: { userId, ...(unreadOnly && { readAt: null }) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: take + 1,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        select: notificationSelect,
      });
    },

    /** Whether `id` is one of the user's notifications (a cursor from someone else is refused). */
    async belongsTo(id: string, userId: string): Promise<boolean> {
      return (await db.notification.count({ where: { id, userId } })) > 0;
    },

    countUnread(userId: string): Promise<number> {
      return db.notification.count({ where: { userId, readAt: null } });
    },

    /** Marks one of the user's notifications read. False if it is not theirs. */
    async markRead(id: string, userId: string, at: Date): Promise<boolean> {
      const found = await db.notification.findFirst({
        where: { id, userId },
        select: { id: true },
      });
      if (!found) return false;
      await db.notification.updateMany({ where: { id, readAt: null }, data: { readAt: at } });
      return true;
    },

    async markAllRead(userId: string, at: Date): Promise<void> {
      await db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: at } });
    },

    /** What the email needs. Null once emailed, or for a disabled account. */
    findForEmail(id: string) {
      return db.notification.findFirst({
        where: { id, emailedAt: null, user: { disabledAt: null } },
        select: {
          id: true,
          userId: true,
          kind: true,
          title: true,
          body: true,
          link: true,
          user: { select: { email: true, name: true } },
        },
      });
    },

    async markEmailed(id: string, at: Date): Promise<void> {
      await db.notification.updateMany({ where: { id, emailedAt: null }, data: { emailedAt: at } });
    },

    /** The kinds the user turned email off for. */
    async emailOptOuts(userId: string): Promise<NotificationKind[]> {
      const rows = await db.notificationPreference.findMany({
        where: { userId, email: false },
        select: { kind: true },
      });
      return rows.map((row) => row.kind);
    },

    /** Of `userIds`, those who turned email off for `kind`. */
    async optedOutOf(kind: NotificationKind, userIds: string[]): Promise<Set<string>> {
      if (userIds.length === 0) return new Set();
      const rows = await db.notificationPreference.findMany({
        where: { kind, email: false, userId: { in: userIds } },
        select: { userId: true },
      });
      return new Set(rows.map((row) => row.userId));
    },

    /** Saves the user's email choices, one row per kind given. */
    async setEmailPreferences(
      userId: string,
      email: Partial<Record<NotificationKind, boolean>>,
    ): Promise<void> {
      await db.$transaction(
        Object.entries(email).map(([kind, on]) =>
          db.notificationPreference.upsert({
            where: { userId_kind: { userId, kind: kind as NotificationKind } },
            create: { userId, kind: kind as NotificationKind, email: on },
            update: { email: on },
          }),
        ),
      );
    },
  };
}

export type NotificationRepository = ReturnType<typeof createNotificationRepository>;
