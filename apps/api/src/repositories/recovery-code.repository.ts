import type { Db } from './prisma';

export interface StoredRecoveryCode {
  id: string;
  /** Argon2id hash of the normalized code. */
  codeHash: string;
}

export function createRecoveryCodeRepository(db: Db) {
  return {
    listUnused(userId: string): Promise<StoredRecoveryCode[]> {
      return db.recoveryCode.findMany({
        where: { userId, usedAt: null },
        select: { id: true, codeHash: true },
        orderBy: { id: 'asc' },
      });
    },

    countUnused(userId: string): Promise<number> {
      return db.recoveryCode.count({ where: { userId, usedAt: null } });
    },

    /** Conditional, so a code used by two requests at once works for only one of them. */
    async markUsed(id: string, at: Date): Promise<boolean> {
      const { count } = await db.recoveryCode.updateMany({
        where: { id, usedAt: null },
        data: { usedAt: at },
      });
      return count === 1;
    },

    /** Every old code stops working; the new hashes replace them in one transaction. */
    async replaceAll(userId: string, codeHashes: string[]): Promise<void> {
      await db.$transaction([
        db.recoveryCode.deleteMany({ where: { userId } }),
        db.recoveryCode.createMany({ data: codeHashes.map((codeHash) => ({ userId, codeHash })) }),
      ]);
    },
  };
}

export type RecoveryCodeRepository = ReturnType<typeof createRecoveryCodeRepository>;
