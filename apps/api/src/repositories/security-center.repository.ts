import type { Db } from './prisma';
import { auditSelect, type SystemAuditRecord } from './system.repository';

/*
 * Reads for the /system security center: failed sign-ins (from the audit log), accounts on
 * hold, super admin lockouts, what super admins did, and quarantined files. Details only:
 * never a storage key, and the service hides private titles (supportTitleOf).
 */

/** Wrong passwords, blocked sign-ins and wrong MFA codes. */
const FAILED_SIGN_IN = ['login_failed', 'mfa_failed'] as const;

/** Page views are left out of "recent admin actions": every console read records one. */
const NOT_ADMIN_ACTIONS = ['system_view'] as const;

/** How many quarantined files the list shows (the total is always exact). */
const QUARANTINE_LIST_MAX = 50;
const LOCKED_LIST_MAX = 100;

export interface FailedByIp {
  ip: string | null;
  count: number;
  lastAt: Date;
}

export interface FailedByAccount {
  userId: string | null;
  email: string | null;
  organization: string | null;
  count: number;
  lastAt: Date;
}

export function createSecurityCenterRepository(db: Db) {
  return {
    countFailedSignIns(since: Date): Promise<number> {
      return db.auditLog.count({
        where: { action: { in: [...FAILED_SIGN_IN] }, createdAt: { gte: since } },
      });
    },

    failedSignInsByIp(since: Date, take: number): Promise<FailedByIp[]> {
      return db.$queryRaw<FailedByIp[]>`
        SELECT a.ip AS "ip", COUNT(*)::int AS "count", MAX(a.created_at) AS "lastAt"
        FROM audit_logs a
        WHERE a.action IN ('login_failed', 'mfa_failed') AND a.created_at >= ${since}
        GROUP BY a.ip
        ORDER BY "count" DESC, "lastAt" DESC
        LIMIT ${take}`;
    },

    /** Per account; an email that belongs to no account is grouped by what was typed. */
    failedSignInsByAccount(since: Date, take: number): Promise<FailedByAccount[]> {
      return db.$queryRaw<FailedByAccount[]>`
        SELECT a.actor_id AS "userId",
               COALESCE(u.email, a.metadata->>'email') AS "email",
               o.acronym AS "organization",
               COUNT(*)::int AS "count",
               MAX(a.created_at) AS "lastAt"
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.actor_id
        LEFT JOIN organizations o ON o.id = u.organization_id
        WHERE a.action IN ('login_failed', 'mfa_failed') AND a.created_at >= ${since}
        GROUP BY a.actor_id, COALESCE(u.email, a.metadata->>'email'), o.acronym
        ORDER BY "count" DESC, "lastAt" DESC
        LIMIT ${take}`;
    },

    /** Active accounts on hold, newest hold first. */
    lockedAccounts() {
      return db.user.findMany({
        where: { lockedAt: { not: null }, disabledAt: null },
        orderBy: { lockedAt: 'desc' },
        take: LOCKED_LIST_MAX,
        select: {
          id: true,
          email: true,
          lockedAt: true,
          lockReason: true,
          organization: { select: { acronym: true } },
        },
      });
    },

    superAdminLockouts(since: Date, take: number) {
      return db.auditLog.findMany({
        where: { action: 'super_admin_lockout', createdAt: { gte: since } },
        orderBy: { id: 'desc' },
        take,
        select: { createdAt: true, actorId: true, ip: true, actor: { select: { email: true } } },
      });
    },

    recentAdminActions(take: number): Promise<SystemAuditRecord[]> {
      return db.auditLog.findMany({
        where: {
          actor: { systemRole: 'SUPER_ADMIN' },
          action: { notIn: [...NOT_ADMIN_ACTIONS] },
        },
        orderBy: { id: 'desc' },
        take,
        select: auditSelect,
      });
    },

    async quarantined() {
      const where = { status: 'quarantined' as const, deletedAt: null };
      const [items, total] = await db.$transaction([
        db.document.findMany({
          where,
          orderBy: { id: 'desc' },
          take: QUARANTINE_LIST_MAX,
          select: {
            id: true,
            title: true,
            visibility: true,
            createdAt: true,
            organization: { select: { acronym: true, slug: true } },
            versions: {
              orderBy: { version: 'desc' },
              take: 1,
              select: {
                scanStatus: true,
                failureReason: true,
                mimeType: true,
                sizeBytes: true,
                processedAt: true,
              },
            },
          },
        }),
        db.document.count({ where }),
      ]);
      return { items, total };
    },
  };
}

export type SecurityCenterRepository = ReturnType<typeof createSecurityCenterRepository>;
