import type { RevealPurpose } from '#src/generated/prisma/client';
import type { Db } from './prisma';

/*
 * One-time Reveals (docs/DOMAIN_RULES.md, "Accounts"): one encrypted copy of temporary
 * passwords, for one recipient. Opening it erases the copy in the same transaction, so two
 * clicks can never both get it.
 */

const STATUS_SELECT = {
  id: true,
  recipientId: true,
  purpose: true,
  entryCount: true,
  createdAt: true,
  expiresAt: true,
  revealedAt: true,
} as const;

export interface NewReveal {
  recipientId: string;
  purpose: RevealPurpose;
  entryCount: number;
  issuedById: string | null;
  expiresAt: Date;
  /** Encrypts the payload for the new row's id (the copy is bound to it). */
  seal: (revealId: string) => string;
}

export function createRevealRepository(db: Db) {
  return {
    async create(input: NewReveal): Promise<string> {
      return db.$transaction(async (tx) => {
        const { id } = await tx.passwordReveal.create({
          data: {
            recipientId: input.recipientId,
            purpose: input.purpose,
            entryCount: input.entryCount,
            issuedById: input.issuedById,
            expiresAt: input.expiresAt,
          },
          select: { id: true },
        });
        await tx.passwordReveal.update({ where: { id }, data: { sealed: input.seal(id) } });
        return id;
      });
    },

    /** Its state, for its recipient only. */
    findForRecipient(id: string, recipientId: string) {
      return db.passwordReveal.findFirst({
        where: { id, recipientId },
        select: { ...STATUS_SELECT, sealed: true },
      });
    },

    /**
     * Takes the sealed copy and erases it, once: null when it is someone else's, already
     * revealed, expired or erased. The row is locked so a second click waits and then finds
     * nothing.
     */
    async take(id: string, recipientId: string, now: Date) {
      return db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM password_reveals WHERE id = ${id}::uuid FOR UPDATE`;
        const row = await tx.passwordReveal.findFirst({
          where: {
            id,
            recipientId,
            revealedAt: null,
            sealed: { not: null },
            expiresAt: { gt: now },
          },
          select: { ...STATUS_SELECT, sealed: true },
        });
        if (!row) return null;
        await tx.passwordReveal.update({
          where: { id },
          data: { sealed: null, revealedAt: now },
        });
        return { ...row, sealed: row.sealed! };
      });
    },

    /** Erases the copies nobody revealed in time. Returns how many. */
    async purgeExpired(now: Date): Promise<number> {
      const { count } = await db.passwordReveal.updateMany({
        where: { expiresAt: { lte: now }, sealed: { not: null } },
        data: { sealed: null },
      });
      return count;
    },
  };
}

export type RevealRepository = ReturnType<typeof createRevealRepository>;
