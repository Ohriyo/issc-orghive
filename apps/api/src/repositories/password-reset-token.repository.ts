import type { Db } from './prisma';

export function createPasswordResetTokenRepository(db: Db) {
  return {
    /** Stores a new link and invalidates the user's earlier unused ones, so only the latest works. */
    async create(token: { userId: string; tokenHash: string; expiresAt: Date }, at: Date) {
      await db.$transaction([
        db.passwordResetToken.updateMany({
          where: { userId: token.userId, usedAt: null },
          data: { usedAt: at },
        }),
        db.passwordResetToken.create({ data: token }),
      ]);
    },

    /**
     * Marks the token used if it is unused and unexpired, atomically, and returns its user.
     * Returns null for an unknown, expired or already-used token (a second use always fails).
     */
    consume(tokenHash: string, at: Date): Promise<string | null> {
      return db.$transaction(async (tx) => {
        const { count } = await tx.passwordResetToken.updateMany({
          where: { tokenHash, usedAt: null, expiresAt: { gt: at } },
          data: { usedAt: at },
        });
        if (count === 0) return null;
        const row = await tx.passwordResetToken.findUnique({
          where: { tokenHash },
          select: { userId: true },
        });
        return row?.userId ?? null;
      });
    },
  };
}

export type PasswordResetTokenRepository = ReturnType<typeof createPasswordResetTokenRepository>;
