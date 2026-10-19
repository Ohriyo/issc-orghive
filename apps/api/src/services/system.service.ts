import {
  ErrorCode,
  type SystemAuditListResponse,
  type SystemAuditQuery,
  type SystemOverview,
  type SystemUser,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import type { Logger } from '#src/logger';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import {
  DuplicateAccountError,
  type AccountAdminRepository,
} from '#src/repositories/account-admin.repository';
import type { RefreshTokenRepository } from '#src/repositories/refresh-token.repository';
import type { SystemRepository } from '#src/repositories/system.repository';
import { toAuditEntry, toSystemUser } from '#src/services/account-admin.service';
import type { RequestContext } from '#src/services/auth.service';
import {
  decideAccountChange,
  isActiveSuperAdmin,
  type AccountChange,
  type AccountRefusal,
  type AccountState,
} from '#src/services/super-admin-rules';

/** Job counts of one background queue (BullMQ), for the overview. */
export interface QueueCounts {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

export interface SystemServiceDeps {
  system: SystemRepository;
  accounts: Pick<AccountAdminRepository, 'find'>;
  refreshTokens: Pick<RefreshTokenRepository, 'revokeAllForUser'>;
  audit: Pick<AuditLogRepository, 'record'>;
  /** Counts per queue; may throw when Redis is down (the overview then shows none). */
  queues: () => Promise<QueueCounts[]>;
  logger: Logger;
  now?: () => Date;
}

const DEFAULT_PAGE = 25;
/** A scan still running after this long is reported as stuck. */
const STUCK_SCAN_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const REFUSALS: Record<AccountRefusal, () => AppError> = {
  self_deactivation: () =>
    new AppError(409, ErrorCode.CONFLICT, 'You cannot deactivate your own account'),
  last_super_admin: () =>
    new AppError(
      409,
      ErrorCode.LAST_SUPER_ADMIN,
      'Orghive needs at least one active super admin. Add another with the create-super-admin command first.',
    ),
  not_super_admin: () => new AppError(409, ErrorCode.CONFLICT, 'This account is not a super admin'),
};

/** What an audit entry records about an account, before and after a change. */
function snapshot(account: AccountState) {
  return {
    systemRole: account.systemRole,
    disabledAt: account.disabledAt?.toISOString() ?? null,
    mfaEnabled: account.mfaEnabledAt !== null,
  };
}

/** Splits the extra row the repository fetched into `nextCursor`. */
function page<T extends { id: string }>(rows: T[], take: number) {
  const items = rows.slice(0, take);
  return { items, nextCursor: rows.length > take ? (items.at(-1)?.id ?? null) : null };
}

export function createSystemService(deps: SystemServiceDeps) {
  const { system, audit } = deps;
  const now = deps.now ?? (() => new Date());

  /** Applies a guarded change; returns the account after it, and its audit snapshot. */
  async function change(
    actorId: string,
    targetId: string,
    kind: AccountChange,
    ctx: RequestContext,
  ): Promise<SystemUser> {
    const at = now();
    const { decision, before } = await system
      .applyAccountChange(targetId, (target, active) =>
        decideAccountChange({ actorId, target, change: kind, activeSuperAdminIds: active, at }),
      )
      .catch((err: unknown) => {
        if (err instanceof DuplicateAccountError) {
          throw AppError.conflict(
            'This organization already has another active account. Deactivate that one first.',
          );
        }
        throw err;
      });
    if (!before) throw AppError.notFound('User not found');
    if (decision.kind === 'refuse') throw REFUSALS[decision.reason]();

    if (decision.kind === 'apply') {
      // A deactivated or demoted account is signed out everywhere; its next request fails.
      if (kind !== 'reactivate') await deps.refreshTokens.revokeAllForUser(targetId, at);
      const after = await system.findAccount(targetId);
      await audit.record({
        action:
          kind === 'demote'
            ? 'system_role_change'
            : kind === 'deactivate'
              ? 'user_deactivate'
              : 'user_reactivate',
        actorId,
        entityType: 'user',
        entityId: targetId,
        metadata: { before: snapshot(before), after: after ? snapshot(after) : null },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    }

    const user = await deps.accounts.find(targetId);
    if (!user) throw AppError.notFound('User not found');
    return toSystemUser(user);
  }

  return {
    /** For requireSuperAdmin: the database must still say active SUPER_ADMIN. */
    async assertSuperAdmin(userId: string): Promise<void> {
      const account = await system.findAccount(userId);
      if (!account || !isActiveSuperAdmin(account)) {
        throw AppError.forbidden('Only super admins can open the system console');
      }
    },

    async recordView(userId: string, route: string, ctx: RequestContext): Promise<void> {
      await audit.record({
        action: 'system_view',
        actorId: userId,
        entityType: 'system',
        metadata: { route },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    },

    async overview(): Promise<SystemOverview> {
      const at = now();
      const [counts, queues] = await Promise.all([
        system.overviewCounts({
          stuckBefore: new Date(at.getTime() - STUCK_SCAN_MS),
          since: new Date(at.getTime() - DAY_MS),
        }),
        deps.queues().catch((err: unknown) => {
          deps.logger.warn({ err }, 'Queue counts unavailable for the system overview');
          return [];
        }),
      ]);
      return {
        users: {
          total: counts.users.total,
          active: counts.users.total - counts.users.disabled,
          disabled: counts.users.disabled,
        },
        superAdmins: counts.superAdmins,
        organizations: counts.organizations,
        documents: { ...counts.documents, stuckScanning: counts.stuckScanning },
        queues,
        auditEventsLast24h: counts.auditEventsSince,
        failedLoginsLast24h: counts.failedLoginsSince,
        generatedAt: at.toISOString(),
      };
    },

    async listAuditLogs({ limit, ...query }: SystemAuditQuery): Promise<SystemAuditListResponse> {
      const take = limit ?? DEFAULT_PAGE;
      const { items, nextCursor } = page(await system.listAuditLogs(query, take), take);
      return { items: items.map(toAuditEntry), nextCursor };
    },

    /** Deactivate (signs them out everywhere) or reactivate. Never yourself, never the last. */
    setUserActive(actorId: string, targetId: string, active: boolean, ctx: RequestContext) {
      return change(actorId, targetId, active ? 'reactivate' : 'deactivate', ctx);
    },

    /** SUPER_ADMIN → NONE; their authenticator and recovery codes are removed. Never the last. */
    demote(actorId: string, targetId: string, ctx: RequestContext) {
      return change(actorId, targetId, 'demote', ctx);
    },
  };
}

export type SystemService = ReturnType<typeof createSystemService>;
