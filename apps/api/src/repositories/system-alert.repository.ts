import type { Db } from './prisma';

export interface AlertRow {
  id: string;
  kind: string;
  message: string;
  openedAt: Date;
  notifiedAt: Date | null;
}

const SELECT = { id: true, kind: true, message: true, openedAt: true, notifiedAt: true } as const;

export function createSystemAlertRepository(db: Db) {
  return {
    /** Open alerts, oldest first. */
    listOpen(): Promise<AlertRow[]> {
      return db.systemAlert.findMany({
        where: { resolvedAt: null },
        orderBy: { openedAt: 'asc' },
        select: SELECT,
      });
    },

    /**
     * Opens an alert of `kind` unless one is open. Returns the new alert, or null when one
     * was open already (another API instance may have opened it a moment ago: the partial
     * unique index makes the second insert a no-op).
     */
    async open(kind: string, message: string, at: Date): Promise<AlertRow | null> {
      const { count } = await db.systemAlert.createMany({
        data: [{ kind, message, openedAt: at }],
        skipDuplicates: true,
      });
      if (count === 0) return null;
      return db.systemAlert.findFirst({
        where: { kind, resolvedAt: null },
        select: SELECT,
      });
    },

    /** Keeps an open alert's message current (the disk went from 86% to 90%). */
    async updateMessage(kind: string, message: string): Promise<void> {
      await db.systemAlert.updateMany({
        where: { kind, resolvedAt: null, NOT: { message } },
        data: { message },
      });
    },

    async resolve(kind: string, at: Date): Promise<number> {
      const { count } = await db.systemAlert.updateMany({
        where: { kind, resolvedAt: null },
        data: { resolvedAt: at },
      });
      return count;
    },

    /** When an alert of `kind` was last emailed, open or resolved. */
    async lastNotifiedAt(kind: string): Promise<Date | null> {
      const row = await db.systemAlert.findFirst({
        where: { kind, notifiedAt: { not: null } },
        orderBy: { notifiedAt: 'desc' },
        select: { notifiedAt: true },
      });
      return row?.notifiedAt ?? null;
    },

    /** Claims the email for one alert; false when another instance claimed it first. */
    async claimNotification(id: string, at: Date): Promise<boolean> {
      const { count } = await db.systemAlert.updateMany({
        where: { id, notifiedAt: null },
        data: { notifiedAt: at },
      });
      return count === 1;
    },
  };
}

export type SystemAlertRepository = ReturnType<typeof createSystemAlertRepository>;
