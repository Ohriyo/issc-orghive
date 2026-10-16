import type { Prisma } from '#src/generated/prisma/client';
import type { Db } from './prisma';

const refreshTokenSelect = {
  id: true,
  userId: true,
  familyId: true,
  expiresAt: true,
  sessionExpiresAt: true,
  revokedAt: true,
  replacedById: true,
} satisfies Prisma.RefreshTokenSelect;

export type RefreshTokenRecord = Prisma.RefreshTokenGetPayload<{
  select: typeof refreshTokenSelect;
}>;

export interface NewRefreshToken {
  userId: string;
  /** SHA-256 of the token; the token itself is never stored. */
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  sessionExpiresAt: Date;
  userAgent?: string;
}

export function createRefreshTokenRepository(db: Db) {
  return {
    async create(token: NewRefreshToken): Promise<void> {
      await db.refreshToken.create({ data: token });
    },

    findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
      return db.refreshToken.findUnique({ where: { tokenHash }, select: refreshTokenSelect });
    },

    /**
     * Revokes `oldId` and stores its replacement, atomically. The revoke is conditional
     * (`revokedAt IS NULL`), so when two requests race with the same token only one wins;
     * the loser gets `false` and must treat it as reuse.
     */
    rotate(oldId: string, next: NewRefreshToken, at: Date): Promise<boolean> {
      return db.$transaction(async (tx) => {
        const { count } = await tx.refreshToken.updateMany({
          where: { id: oldId, revokedAt: null },
          data: { revokedAt: at },
        });
        if (count === 0) return false;
        const created = await tx.refreshToken.create({ data: next, select: { id: true } });
        await tx.refreshToken.update({ where: { id: oldId }, data: { replacedById: created.id } });
        return true;
      });
    },

    /** Ends a session: every token of the family, past and current. */
    async revokeFamily(familyId: string, at: Date): Promise<void> {
      await db.refreshToken.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: at },
      });
    },

    /** Ends every session of the user, e.g. after a password reset. */
    async revokeAllForUser(userId: string, at: Date): Promise<void> {
      await db.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: at },
      });
    },
  };
}

export type RefreshTokenRepository = ReturnType<typeof createRefreshTokenRepository>;
