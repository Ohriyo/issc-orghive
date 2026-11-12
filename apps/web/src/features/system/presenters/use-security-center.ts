import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { securityCenterSchema, type SecurityCenter, type SecurityRange } from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatBytes } from './health-format';
import { actionLabel, formatCount, formatDateTime } from './system-format';

export const RANGE_OPTIONS: { value: SecurityRange; label: string }[] = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
];

/** Where each rate limit sits, in the console's words. */
const LIMITER_LABELS: Record<string, string> = {
  'login-ip': 'Sign-in, per IP',
  'login-account': 'Sign-in, per account',
  'forgot-ip': 'Password reset email, per IP',
  'forgot-account': 'Password reset email, per address',
  'password-checks': 'Password checks',
  refresh: 'Session refresh',
  viewer: 'Document viewer',
  pages: 'Viewer page images',
};

const KIND_LABELS = {
  virus: 'Virus found',
  file_type: 'Wrong file type',
  task_check: 'Failed task file check',
  unknown: 'Refused',
} as const;

function toModel(data: SecurityCenter) {
  return {
    since: formatDateTime(data.since),
    generatedAt: formatDateTime(data.generatedAt),
    failedLogins: {
      total: formatCount(data.failedLogins.total),
      byIp: data.failedLogins.byIp.map((row) => ({
        key: row.ip ?? 'unknown',
        ip: row.ip ?? 'Unknown IP',
        count: formatCount(row.count),
        last: formatDateTime(row.lastAt),
      })),
      byAccount: data.failedLogins.byAccount.map((row) => ({
        key: `${row.userId ?? 'none'}:${row.email ?? ''}`,
        account: row.email ?? 'No email given',
        detail: row.userId
          ? (row.organization ?? 'Super admin or account without an organization')
          : 'No such account',
        userId: row.userId,
        count: formatCount(row.count),
        last: formatDateTime(row.lastAt),
      })),
    },
    lockedAccounts: data.lockedAccounts.map((row) => ({
      userId: row.userId,
      account: row.organization ? `${row.organization} · ${row.email}` : row.email,
      reason: row.reason ?? 'No reason recorded',
      since: formatDateTime(row.lockedAt),
    })),
    superAdminLockouts: data.superAdminLockouts.map((row, i) => ({
      key: `${row.at}-${i}`,
      account: row.email ?? 'Unknown account',
      ip: row.ip ?? 'Unknown IP',
      at: formatDateTime(row.at),
    })),
    rateLimits: {
      total: formatCount(data.rateLimitHits.total),
      byLimiter: data.rateLimitHits.byLimiter.map((row) => ({
        key: row.limiter,
        label: LIMITER_LABELS[row.limiter] ?? row.limiter,
        hits: formatCount(row.hits),
      })),
      byIp: data.rateLimitHits.byIp.map((row) => ({
        key: row.ip,
        ip: row.ip,
        hits: formatCount(row.hits),
        limiters: row.limiters.map((l) => LIMITER_LABELS[l] ?? l).join(', '),
      })),
    },
    adminActions: data.recentAdminActions.map((entry) => ({
      id: entry.id,
      when: formatDateTime(entry.createdAt),
      action: actionLabel(entry.action),
      actor: entry.actor?.name ?? 'System',
      target: entry.entityId ? `${entry.entityType} ${entry.entityId}` : entry.entityType,
    })),
    quarantined: {
      total: data.quarantined.total,
      shown: data.quarantined.items.length,
      rows: data.quarantined.items.map((item) => ({
        id: item.documentId,
        organization: item.organization.acronym,
        organizationSlug: item.organization.slug,
        title: item.title ?? 'Private file (title hidden)',
        kind: KIND_LABELS[item.kind],
        reason: item.reason,
        file: `${item.mimeType} · ${formatBytes(item.sizeBytes)}`,
        when: formatDateTime(item.quarantinedAt ?? item.uploadedAt),
      })),
    },
  };
}

/**
 * /system/security-center: failed sign-ins, accounts on hold, super admin lockouts, rate
 * limit hits, recent super admin actions and quarantined files, over 24 hours or 7 days.
 * Read-only.
 */
export function useSecurityCenter() {
  const [range, setRange] = useState<SecurityRange>('24h');
  const query = useQuery({
    queryKey: queryKeys.system.securityCenter(range),
    queryFn: () =>
      api.get(`/system/security-center?range=${range}`, { schema: securityCenterSchema }),
    staleTime: 30_000,
  });

  const base = { range, setRange, rangeOptions: RANGE_OPTIONS };
  if (query.isPending) return { ...base, status: 'loading' as const };
  if (query.isError)
    return { ...base, status: 'error' as const, retry: () => void query.refetch() };
  return {
    ...base,
    status: 'ready' as const,
    ...toModel(query.data),
    refresh: () => void query.refetch(),
    isRefreshing: query.isFetching,
  };
}

export type SecurityCenterModel = ReturnType<typeof useSecurityCenter>;
