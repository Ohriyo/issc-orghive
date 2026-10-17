import type { NotificationKind, Prisma } from '#src/generated/prisma/client';
import type { Db } from './prisma';

const notificationSelect = {
  id: true,
  kind: true,
  title: true,
  body: true,
  link: true,
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
}

export function createNotificationRepository(db: Db) {
  return {
    /** Inserts the notifications not already sent (by dedupe key). Returns the new ids. */
    async createMany(rows: NewNotification[]): Promise<string[]> {
      if (rows.length === 0) return [];
      const created = await db.notification.createManyAndReturn({
        data: rows,
        skipDuplicates: true,
        select: { id: true },
      });
      return created.map((row) => row.id);
    },

    listForUser(userId: string, take: number): Promise<NotificationRecord[]> {
      return db.notification.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        select: notificationSelect,
      });
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
  };
}

export type NotificationRepository = ReturnType<typeof createNotificationRepository>;
