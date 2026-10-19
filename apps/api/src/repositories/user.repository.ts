import type { Prisma } from '#src/generated/prisma/client';
import type { Db } from './prisma';

const credentialSelect = {
  id: true,
  email: true,
  name: true,
  passwordHash: true,
  mustChangePassword: true,
  disabledAt: true,
  lockedAt: true,
  systemRole: true,
  /** Encrypted (lib/secret-box.ts); only the MFA service opens it. */
  mfaSecret: true,
  mfaEnabledAt: true,
  mfaLastTimeStep: true,
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

    /** A successful sign-in, for the "last login" filter and column. */
    async recordLogin(userId: string, at: Date): Promise<void> {
      await db.user.update({ where: { id: userId }, data: { lastLoginAt: at } });
    },

    /** Stores a new Argon2id hash and clears the forced-change flag. */
    async setPassword(userId: string, passwordHash: string, at: Date): Promise<void> {
      await db.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: false, passwordChangedAt: at },
      });
    },

    /**
     * Records the TOTP time step a code matched. Conditional, so when two requests race with
     * the same code only one wins; the loser gets `false` and must refuse the code.
     */
    async recordTotpStep(userId: string, timeStep: number): Promise<boolean> {
      const { count } = await db.user.updateMany({
        where: {
          id: userId,
          OR: [{ mfaLastTimeStep: null }, { mfaLastTimeStep: { lt: timeStep } }],
        },
        data: { mfaLastTimeStep: timeStep },
      });
      return count === 1;
    },

    /** Confirms the pending authenticator and stores fresh recovery code hashes, atomically. */
    async enableMfa(userId: string, codeHashes: string[], at: Date): Promise<void> {
      await db.$transaction([
        db.user.update({ where: { id: userId }, data: { mfaEnabledAt: at } }),
        db.recoveryCode.deleteMany({ where: { userId } }),
        db.recoveryCode.createMany({ data: codeHashes.map((codeHash) => ({ userId, codeHash })) }),
      ]);
    },
  };
}

export type UserRepository = ReturnType<typeof createUserRepository>;
