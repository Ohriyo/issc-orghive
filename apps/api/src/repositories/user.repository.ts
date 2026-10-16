import type { Prisma } from '#src/generated/prisma/client';
import type { Db } from './prisma';

const credentialSelect = {
  id: true,
  email: true,
  name: true,
  passwordHash: true,
  mustChangePassword: true,
  disabledAt: true,
} satisfies Prisma.UserSelect;

/** Everything authentication needs about a user, including the password hash. Never returned to clients. */
export type UserCredentials = Prisma.UserGetPayload<{ select: typeof credentialSelect }>;

export function createUserRepository(db: Db) {
  return {
    /** `email` must already be normalized (trimmed, lowercased) by the shared schema. */
    findByEmail(email: string): Promise<UserCredentials | null> {
      return db.user.findUnique({ where: { email }, select: credentialSelect });
    },

    findById(id: string): Promise<UserCredentials | null> {
      return db.user.findUnique({ where: { id }, select: credentialSelect });
    },

    /** Stores a new Argon2id hash and clears the forced-change flag. */
    async setPassword(userId: string, passwordHash: string, at: Date): Promise<void> {
      await db.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: false, passwordChangedAt: at },
      });
    },
  };
}

export type UserRepository = ReturnType<typeof createUserRepository>;
