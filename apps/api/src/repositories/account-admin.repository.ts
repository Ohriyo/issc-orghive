import type { SystemUserListQuery } from '@orghive/shared';
import { Prisma } from '#src/generated/prisma/client';
import type { Db } from './prisma';
import { dayOf } from './account.repository';

/*
 * The /system console's reads and writes on accounts (docs/DOMAIN_RULES.md, "Accounts").
 * Unique violations (a taken email, a second active account for an organization) surface as
 * Prisma P2002 errors; the service turns them into 409s.
 */

/** A unique rule refused the write: the email is taken, or the organization has an account. */
export class DuplicateAccountError extends Error {
  constructor(readonly field: 'email' | 'organization') {
    super(`Duplicate account ${field}`);
  }
}

async function guardUnique<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new DuplicateAccountError(
        JSON.stringify(err.meta ?? {}).includes('email') ? 'email' : 'organization',
      );
    }
    throw err;
  }
}

export const ACCOUNT_SELECT = {
  id: true,
  name: true,
  email: true,
  systemRole: true,
  mfaEnabledAt: true,
  disabledAt: true,
  lockedAt: true,
  lockReason: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  organizationId: true,
  organization: {
    select: {
      id: true,
      slug: true,
      acronym: true,
      name: true,
      type: true,
      college: { select: { code: true } },
    },
  },
  officerTerms: {
    where: { endedAt: null },
    orderBy: { termStart: 'desc' },
    take: 1,
    select: {
      id: true,
      officerName: true,
      officerPosition: true,
      officerEmail: true,
      termEnd: true,
    },
  },
} satisfies Prisma.UserSelect;

export type AccountRecord = Prisma.UserGetPayload<{ select: typeof ACCOUNT_SELECT }>;

const DAY_MS = 24 * 60 * 60 * 1000;

export type AccountListFilters = Omit<SystemUserListQuery, 'page' | 'pageSize'> & {
  page: number;
  pageSize: number;
};

function whereOf(
  { q, role, type, college, organization, status, lastLogin, mfa }: AccountListFilters,
  now: Date,
): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = [];
  if (q) {
    and.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { organization: { acronym: { contains: q, mode: 'insensitive' } } },
        { organization: { name: { contains: q, mode: 'insensitive' } } },
      ],
    });
  }
  if (role) and.push({ systemRole: role });
  if (type) and.push({ organization: { type } });
  if (college) and.push({ organization: { college: { slug: college } } });
  if (organization) and.push({ organization: { slug: organization } });
  if (status === 'active') and.push({ disabledAt: null, lockedAt: null });
  if (status === 'locked') and.push({ disabledAt: null, lockedAt: { not: null } });
  if (status === 'deactivated') and.push({ disabledAt: { not: null } });
  if (status === 'must_change') and.push({ disabledAt: null, mustChangePassword: true });
  if (lastLogin === 'never') and.push({ lastLoginAt: null });
  if (lastLogin === '7d') and.push({ lastLoginAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } });
  if (lastLogin === '30d')
    and.push({ lastLoginAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } });
  if (lastLogin === 'older')
    and.push({ lastLoginAt: { lt: new Date(now.getTime() - 30 * DAY_MS) } });
  if (mfa === 'enabled') and.push({ systemRole: 'SUPER_ADMIN', mfaEnabledAt: { not: null } });
  if (mfa === 'pending') and.push({ systemRole: 'SUPER_ADMIN', mfaEnabledAt: null });
  return { AND: and };
}

export interface NewAccount {
  organizationId: string;
  email: string;
  name: string;
  passwordHash: string;
  officer: { name: string; position: string; email: string };
  termStart: Date;
  termEnd: Date | null;
}

export interface AccountPatch {
  email?: string;
  officer?: { name: string; position: string; email: string };
  termEnd?: Date | null;
}

export function createAccountAdminRepository(db: Db) {
  return {
    /** A page of accounts, newest first, and how many match in all. */
    async list(
      filters: AccountListFilters,
      now: Date,
    ): Promise<{ rows: AccountRecord[]; total: number }> {
      const where = whereOf(filters, now);
      const [rows, total] = await db.$transaction([
        db.user.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (filters.page - 1) * filters.pageSize,
          take: filters.pageSize,
          select: ACCOUNT_SELECT,
        }),
        db.user.count({ where }),
      ]);
      return { rows, total };
    },

    find(userId: string): Promise<AccountRecord | null> {
      return db.user.findUnique({ where: { id: userId }, select: ACCOUNT_SELECT });
    },

    /** Officer terms of the account, newest first. */
    terms(userId: string) {
      return db.officerTerm.findMany({
        where: { userId },
        orderBy: [{ termStart: 'desc' }, { createdAt: 'desc' }],
        take: 20,
        select: {
          officerName: true,
          officerPosition: true,
          officerEmail: true,
          termStart: true,
          termEnd: true,
          endedAt: true,
        },
      });
    },

    /** The latest sign-ins and failed attempts on the account. */
    logins(userId: string, take = 10) {
      return db.auditLog.findMany({
        where: { entityType: 'user', entityId: userId, action: { in: ['login', 'login_failed'] } },
        orderBy: { id: 'desc' },
        take,
        select: { action: true, createdAt: true, ip: true, userAgent: true },
      });
    },

    /** Refresh sessions that can still be used. */
    sessions(userId: string, now: Date) {
      return db.refreshToken.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, createdAt: true, expiresAt: true, ip: true },
      });
    },

    /** The organization's active account, if any (one per organization). */
    findActiveForOrganization(organizationId: string) {
      return db.user.findFirst({
        where: { organizationId, disabledAt: null },
        select: { id: true, lockedAt: true },
      });
    },

    /** The account and its first officer term, together. */
    async create(input: NewAccount, now: Date): Promise<string> {
      return guardUnique(() =>
        db.$transaction(async (tx) => {
          const { id } = await tx.user.create({
            data: {
              organizationId: input.organizationId,
              email: input.email,
              name: input.name,
              passwordHash: input.passwordHash,
              mustChangePassword: true,
            },
            select: { id: true },
          });
          await tx.officerTerm.create({
            data: {
              userId: id,
              organizationId: input.organizationId,
              officerName: input.officer.name,
              officerPosition: input.officer.position,
              officerEmail: input.officer.email,
              termStart: dayOf(now),
              termEnd: input.termEnd,
            },
          });
          return id;
        }),
      );
    },

    async emailTaken(email: string): Promise<boolean> {
      return (await db.user.count({ where: { email } })) > 0;
    },

    /**
     * Corrections. A different officer name ends the open term and starts a new one today;
     * otherwise the open term is corrected in place.
     */
    async update(userId: string, patch: AccountPatch, now: Date): Promise<void> {
      await guardUnique(() =>
        db.$transaction(async (tx) => {
          if (patch.email !== undefined) {
            await tx.user.update({ where: { id: userId }, data: { email: patch.email } });
          }
          if (patch.officer === undefined && patch.termEnd === undefined) return;
          const user = await tx.user.findUniqueOrThrow({
            where: { id: userId },
            select: { organizationId: true },
          });
          const open = await tx.officerTerm.findFirst({
            where: { userId, endedAt: null },
            orderBy: { termStart: 'desc' },
          });
          const officer = patch.officer;
          const newPerson = officer && (!open || open.officerName !== officer.name);
          if (newPerson && user.organizationId) {
            if (open) {
              await tx.officerTerm.update({ where: { id: open.id }, data: { endedAt: now } });
            }
            await tx.officerTerm.create({
              data: {
                userId,
                organizationId: user.organizationId,
                officerName: officer.name,
                officerPosition: officer.position,
                officerEmail: officer.email,
                termStart: dayOf(now),
                termEnd: patch.termEnd !== undefined ? patch.termEnd : (open?.termEnd ?? null),
              },
            });
          } else if (open) {
            await tx.officerTerm.update({
              where: { id: open.id },
              data: {
                ...(officer && { officerPosition: officer.position, officerEmail: officer.email }),
                ...(patch.termEnd !== undefined && { termEnd: patch.termEnd }),
              },
            });
          }
        }),
      );
    },

    /*
     * Ending sessions: refresh tokens are revoked, and `sessionsRevokedAt` refuses access
     * tokens issued before it. It is real time, like the tokens' issue time, whatever clock
     * the service runs on.
     */

    /** A new temporary password: the next sign-in must change it, and every session ends. */
    async setTemporaryPassword(userId: string, passwordHash: string, now: Date): Promise<void> {
      await db.$transaction([
        db.user.update({
          where: { id: userId },
          data: { passwordHash, mustChangePassword: true, sessionsRevokedAt: new Date() },
        }),
        db.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: now },
        }),
      ]);
    },

    /** Ends every session of the account at once. */
    async revokeSessions(userId: string, now: Date): Promise<void> {
      await db.$transaction([
        db.user.update({ where: { id: userId }, data: { sessionsRevokedAt: new Date() } }),
        db.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: now },
        }),
      ]);
    },

    /** A lock also ends every session; unlocking leaves sessions as they are (there are none). */
    async setLock(userId: string, reason: string | null, now: Date): Promise<void> {
      if (reason === null) {
        await db.user.update({ where: { id: userId }, data: { lockedAt: null, lockReason: null } });
        return;
      }
      await db.$transaction([
        db.user.update({
          where: { id: userId },
          data: { lockedAt: now, lockReason: reason, sessionsRevokedAt: new Date() },
        }),
        db.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: now },
        }),
      ]);
    },
  };
}

export type AccountAdminRepository = ReturnType<typeof createAccountAdminRepository>;
