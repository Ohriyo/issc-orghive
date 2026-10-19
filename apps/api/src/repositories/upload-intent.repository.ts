import type { Db } from './prisma';

export interface NewUploadIntent {
  key: string;
  organizationId: string;
  userId: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  expiresAt: Date;
}

export interface UploadIntent extends NewUploadIntent {
  usedAt: Date | null;
}

export function createUploadIntentRepository(db: Db) {
  return {
    async create(intent: NewUploadIntent): Promise<void> {
      await db.uploadIntent.create({ data: intent });
    },

    /**
     * Marks an intent used and returns it, only if it belongs to this user and organization,
     * is unused and has not expired. One conditional update, so two requests can never both
     * claim the same upload.
     */
    async claim(
      key: string,
      owner: { userId: string; organizationId: string },
      now: Date,
    ): Promise<UploadIntent | null> {
      const { count } = await db.uploadIntent.updateMany({
        where: {
          key,
          userId: owner.userId,
          organizationId: owner.organizationId,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (count !== 1) return null;
      return db.uploadIntent.findUnique({
        where: { key },
        select: {
          key: true,
          organizationId: true,
          userId: true,
          originalFilename: true,
          contentType: true,
          sizeBytes: true,
          expiresAt: true,
          usedAt: true,
        },
      });
    },

    /** Unclaimed intents whose URL expired before `before`, oldest first (for the sweep). */
    async listAbandoned(before: Date, limit = 100): Promise<string[]> {
      const rows = await db.uploadIntent.findMany({
        where: { usedAt: null, expiresAt: { lt: before } },
        orderBy: { expiresAt: 'asc' },
        take: limit,
        select: { key: true },
      });
      return rows.map((row) => row.key);
    },

    async deleteMany(keys: string[]): Promise<void> {
      if (keys.length > 0) await db.uploadIntent.deleteMany({ where: { key: { in: keys } } });
    },
  };
}

export type UploadIntentRepository = ReturnType<typeof createUploadIntentRepository>;
