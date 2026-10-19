import type { SystemAuditQuery, SystemUserListQuery } from '@orghive/shared';
import type { Prisma } from '#src/generated/prisma/client';
import { AuditAction } from '#src/generated/prisma/enums';
import type { Db } from './prisma';
import type { AccountDecision, AccountPatch, AccountState } from '#src/services/super-admin-rules';

/*
 * Reads and writes for the /system console. Ids are UUIDv7 (time-ordered), so "newest
 * first" is `id desc` and a page cursor is simply the last id seen.
 */

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  systemRole: true,
  mfaEnabledAt: true,
  disabledAt: true,
  createdAt: true,
  organization: { select: { slug: true, acronym: true, type: true } },
} satisfies Prisma.UserSelect;

export type SystemUserRecord = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

const accountSelect = {
  id: true,
  systemRole: true,
  disabledAt: true,
  mfaEnabledAt: true,
} satisfies Prisma.UserSelect;

const auditSelect = {
  id: true,
  createdAt: true,
  action: true,
  actor: { select: { id: true, name: true, email: true } },
  entityType: true,
  entityId: true,
  organizationId: true,
  ip: true,
  userAgent: true,
  metadata: true,
} satisfies Prisma.AuditLogSelect;

export type SystemAuditRecord = Prisma.AuditLogGetPayload<{ select: typeof auditSelect }>;

const ACTIVE_SUPER_ADMIN = {
  systemRole: 'SUPER_ADMIN',
  disabledAt: null,
  mfaEnabledAt: { not: null },
} satisfies Prisma.UserWhereInput;

export interface OverviewCounts {
  users: { total: number; disabled: number };
  superAdmins: { active: number; pendingMfa: number };
  organizations: { total: number; active: number };
  documents: Record<'available' | 'scanning' | 'quarantined' | 'archived', number>;
  stuckScanning: number;
  auditEventsSince: number;
  failedLoginsSince: number;
}

export interface AccountChangeResult {
  decision: AccountDecision;
  /** The target before the change; null when it does not exist. */
  before: AccountState | null;
}

export function createSystemRepository(db: Db) {
  return {
    /** What `requireSuperAdmin` checks on every /system request. */
    findAccount(userId: string): Promise<AccountState | null> {
      return db.user.findUnique({ where: { id: userId }, select: accountSelect });
    },

    async overviewCounts({
      stuckBefore,
      since,
    }: {
      stuckBefore: Date;
      since: Date;
    }): Promise<OverviewCounts> {
      const [
        usersTotal,
        usersDisabled,
        superAdminsActive,
        superAdminsPending,
        orgsTotal,
        orgsActive,
        byStatus,
        stuckScanning,
        auditEventsSince,
        failedLoginsSince,
      ] = await Promise.all([
        db.user.count(),
        db.user.count({ where: { disabledAt: { not: null } } }),
        db.user.count({ where: ACTIVE_SUPER_ADMIN }),
        db.user.count({ where: { systemRole: 'SUPER_ADMIN', mfaEnabledAt: null } }),
        db.organization.count({ where: { deletedAt: null } }),
        db.organization.count({ where: { deletedAt: null, deactivatedAt: null } }),
        db.document.groupBy({
          by: ['status'],
          where: { deletedAt: null },
          _count: { _all: true },
        }),
        db.document.count({
          where: { deletedAt: null, status: 'scanning', createdAt: { lt: stuckBefore } },
        }),
        db.auditLog.count({ where: { createdAt: { gte: since } } }),
        db.auditLog.count({ where: { createdAt: { gte: since }, action: 'login_failed' } }),
      ]);
      const documents = { available: 0, scanning: 0, quarantined: 0, archived: 0 };
      for (const row of byStatus) documents[row.status] = row._count._all;
      return {
        users: { total: usersTotal, disabled: usersDisabled },
        superAdmins: { active: superAdminsActive, pendingMfa: superAdminsPending },
        organizations: { total: orgsTotal, active: orgsActive },
        documents,
        stuckScanning,
        auditEventsSince,
        failedLoginsSince,
      };
    },

    /** One more than `take`, so the caller knows whether another page exists. */
    listUsers(
      { q, role, status, cursor }: Omit<SystemUserListQuery, 'limit'>,
      take: number,
    ): Promise<SystemUserRecord[]> {
      return db.user.findMany({
        where: {
          ...(q && {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          }),
          ...(role && { systemRole: role }),
          ...(status === 'active' && { disabledAt: null }),
          ...(status === 'disabled' && { disabledAt: { not: null } }),
          ...(cursor && { id: { lt: cursor } }),
        },
        orderBy: { id: 'desc' },
        take: take + 1,
        select: USER_SELECT,
      });
    },

    findUser(userId: string): Promise<SystemUserRecord | null> {
      return db.user.findUnique({ where: { id: userId }, select: USER_SELECT });
    },

    /** One more than `take`. An unknown `action` matches nothing. */
    async listAuditLogs(
      { actorId, action, entityType, from, to, cursor }: Omit<SystemAuditQuery, 'limit'>,
      take: number,
    ): Promise<SystemAuditRecord[]> {
      if (action && !Object.hasOwn(AuditAction, action)) return [];
      return db.auditLog.findMany({
        where: {
          ...(actorId && { actorId }),
          ...(action && { action: action as AuditAction }),
          ...(entityType && { entityType }),
          ...((from ?? to) && {
            createdAt: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) },
          }),
          ...(cursor && { id: { lt: cursor } }),
        },
        orderBy: { id: 'desc' },
        take: take + 1,
        select: auditSelect,
      });
    },

    /*
     * create-super-admin. Each issues a pending authenticator: the secret is set, MFA is not
     * confirmed, old recovery codes are gone and every session ends.
     */

    /** `seal` encrypts the TOTP secret for the new id (it is bound to the user id). */
    createSuperAdmin(
      account: { email: string; name: string; passwordHash: string },
      seal: (userId: string) => string,
      at: Date,
    ): Promise<string> {
      return db.$transaction(async (tx) => {
        const { id } = await tx.user.create({
          data: {
            ...account,
            systemRole: 'SUPER_ADMIN',
            mustChangePassword: false,
            passwordChangedAt: at,
          },
          select: { id: true },
        });
        await tx.user.update({ where: { id }, data: { mfaSecret: seal(id) } });
        return id;
      });
    },

    async resetSuperAdminMfa(userId: string, sealedSecret: string, at: Date): Promise<void> {
      await db.$transaction([
        db.recoveryCode.deleteMany({ where: { userId } }),
        db.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: at },
        }),
        db.user.update({
          where: { id: userId },
          data: { mfaSecret: sealedSecret, mfaEnabledAt: null, mfaLastTimeStep: null },
        }),
      ]);
    },

    /** Who to tell about a lockout. */
    async activeSuperAdminEmails(): Promise<string[]> {
      const rows = await db.user.findMany({ where: ACTIVE_SUPER_ADMIN, select: { email: true } });
      return rows.map((row) => row.email);
    },

    /**
     * Runs `decide` on the target and every active super admin, with all of their rows
     * locked (FOR UPDATE, in id order so two transactions never deadlock), then applies the
     * patch it returns. A concurrent change waits, and then sees this one's result.
     */
    applyAccountChange(
      targetId: string,
      decide: (target: AccountState, activeSuperAdminIds: string[]) => AccountDecision,
    ): Promise<AccountChangeResult> {
      return db.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM users
          WHERE system_role = 'SUPER_ADMIN' OR id = ${targetId}::uuid
          ORDER BY id
          FOR UPDATE`;
        const before = await tx.user.findUnique({ where: { id: targetId }, select: accountSelect });
        if (!before) return { decision: { kind: 'unchanged' }, before: null };

        const active = await tx.user.findMany({ where: ACTIVE_SUPER_ADMIN, select: { id: true } });
        const decision = decide(
          before,
          active.map((row) => row.id),
        );
        if (decision.kind === 'apply') await applyPatch(tx, targetId, decision.patch);
        return { decision, before };
      });
    },
  };
}

async function applyPatch(tx: Prisma.TransactionClient, userId: string, patch: AccountPatch) {
  if (patch.demote) {
    await tx.recoveryCode.deleteMany({ where: { userId } });
  }
  await tx.user.update({
    where: { id: userId },
    data: {
      ...('disabledAt' in patch && { disabledAt: patch.disabledAt }),
      ...(patch.demote && {
        systemRole: 'NONE',
        mfaSecret: null,
        mfaEnabledAt: null,
        mfaLastTimeStep: null,
      }),
    },
  });
}

export type SystemRepository = ReturnType<typeof createSystemRepository>;
