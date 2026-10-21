import type { Prisma } from '#src/generated/prisma/client';
import type { Db } from './prisma';

export interface StoredSetting {
  value: Prisma.JsonValue;
  updatedAt: Date;
}

/** Settings the super admin changes (/system). A missing key means the shared default. */
export function createSystemSettingRepository(db: Db) {
  return {
    get(key: string): Promise<StoredSetting | null> {
      return db.systemSetting.findUnique({
        where: { key },
        select: { value: true, updatedAt: true },
      });
    },

    async set(
      key: string,
      value: Prisma.InputJsonValue,
      updatedById: string,
    ): Promise<StoredSetting> {
      return db.systemSetting.upsert({
        where: { key },
        create: { key, value, updatedById },
        update: { value, updatedById },
        select: { value: true, updatedAt: true },
      });
    },
  };
}

export type SystemSettingRepository = ReturnType<typeof createSystemSettingRepository>;
