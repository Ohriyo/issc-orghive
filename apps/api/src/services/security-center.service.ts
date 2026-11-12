import { SECURITY_LIST_MAX, type SecurityCenter, type SecurityRange } from '@orghive/shared';
import type { RateLimitHitReader } from '#src/lib/rate-limit-hits';
import type { Logger } from '#src/logger';
import { supportTitleOf } from '#src/repositories/document-visibility';
import type { SecurityCenterRepository } from '#src/repositories/security-center.repository';
import { toAuditEntry } from '#src/services/account-admin.service';

export interface SecurityCenterServiceDeps {
  security: SecurityCenterRepository;
  rateLimitHits: RateLimitHitReader;
  logger: Logger;
  now?: () => Date;
}

const HOUR_MS = 60 * 60 * 1000;
const RANGE_MS: Record<SecurityRange, number> = { '24h': 24 * HOUR_MS, '7d': 7 * 24 * HOUR_MS };

/** Why the worker refused a file, from its version's scan status. */
const KIND = {
  infected: 'virus',
  invalid: 'file_type',
  rejected: 'task_check',
} as const;

const NO_HITS = { total: 0, byLimiter: [], byIp: [] };

/**
 * /system/security-center: who is failing to sign in and from where, accounts on hold,
 * super admin lockouts, requests refused by a rate limit, what super admins did lately and
 * the files in quarantine. Read-only. A private file's title stays hidden (supportTitleOf).
 */
export function createSecurityCenterService({
  security,
  rateLimitHits,
  logger,
  now = () => new Date(),
}: SecurityCenterServiceDeps) {
  return {
    async read(range: SecurityRange): Promise<SecurityCenter> {
      const at = now();
      const since = new Date(at.getTime() - RANGE_MS[range]);
      const [total, byIp, byAccount, locked, lockouts, hits, actions, quarantined] =
        await Promise.all([
          security.countFailedSignIns(since),
          security.failedSignInsByIp(since, SECURITY_LIST_MAX),
          security.failedSignInsByAccount(since, SECURITY_LIST_MAX),
          security.lockedAccounts(),
          security.superAdminLockouts(since, SECURITY_LIST_MAX),
          // Redis down: the rest of the page still answers.
          rateLimitHits.read(since, at, SECURITY_LIST_MAX).catch((err: unknown) => {
            logger.warn({ err }, 'Rate limit hits unavailable for the security center');
            return NO_HITS;
          }),
          security.recentAdminActions(SECURITY_LIST_MAX),
          security.quarantined(),
        ]);

      return {
        range,
        since: since.toISOString(),
        failedLogins: {
          total,
          byIp: byIp.map((row) => ({
            ip: row.ip,
            count: row.count,
            lastAt: row.lastAt.toISOString(),
          })),
          byAccount: byAccount.map((row) => ({
            userId: row.userId,
            email: row.email,
            organization: row.organization,
            count: row.count,
            lastAt: row.lastAt.toISOString(),
          })),
        },
        lockedAccounts: locked.map((user) => ({
          userId: user.id,
          email: user.email,
          organization: user.organization?.acronym ?? null,
          lockedAt: user.lockedAt!.toISOString(),
          reason: user.lockReason,
        })),
        superAdminLockouts: lockouts.map((row) => ({
          at: row.createdAt.toISOString(),
          userId: row.actorId,
          email: row.actor?.email ?? null,
          ip: row.ip,
        })),
        rateLimitHits: hits,
        recentAdminActions: actions.map(toAuditEntry),
        quarantined: {
          total: quarantined.total,
          items: quarantined.items.map((doc) => {
            const latest = doc.versions[0];
            const status = latest?.scanStatus;
            return {
              documentId: doc.id,
              organization: doc.organization,
              title: supportTitleOf(doc),
              kind:
                status === 'infected' || status === 'invalid' || status === 'rejected'
                  ? KIND[status]
                  : 'unknown',
              reason: latest?.failureReason ?? null,
              mimeType: latest?.mimeType ?? 'application/octet-stream',
              sizeBytes: latest?.sizeBytes ?? 0,
              uploadedAt: doc.createdAt.toISOString(),
              quarantinedAt: latest?.processedAt?.toISOString() ?? null,
            };
          }),
        },
        generatedAt: at.toISOString(),
      };
    },
  };
}

export type SecurityCenterService = ReturnType<typeof createSecurityCenterService>;
