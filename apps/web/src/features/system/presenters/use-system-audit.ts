import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { systemAuditListResponseSchema, type SystemAuditEntry } from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { actionLabel, formatDateTime, toSearch } from './system-format';

/** The actions worth filtering by, grouped as the console thinks of them. */
export const AUDIT_ACTION_OPTIONS = [
  'login',
  'login_failed',
  'logout',
  'token_reuse',
  'mfa_failed',
  'mfa_recovery_used',
  'super_admin_lockout',
  'step_up',
  'system_view',
  'system_role_change',
  'user_deactivate',
  'user_reactivate',
  'super_admin_create',
  'super_admin_mfa_reset',
  'mfa_enroll',
  'recovery_codes_regenerate',
  'admin_override',
  'role_change',
  'upload',
  'visibility_change',
  'archive',
  'restore',
  'delete',
  'approve',
  'reject',
  'organization_change',
  'college_change',
].map((value) => ({ value, label: actionLabel(value) }));

export interface AuditRow {
  id: string;
  when: string;
  action: string;
  actor: string;
  target: string;
  ip: string;
  userAgent: string | null;
  /** Pretty-printed metadata (before/after values, routes), or null. */
  details: string | null;
}

function toRow(entry: SystemAuditEntry): AuditRow {
  return {
    id: entry.id,
    when: formatDateTime(entry.createdAt),
    action: actionLabel(entry.action),
    actor: entry.actor ? `${entry.actor.name} (${entry.actor.email})` : 'System',
    target: entry.entityId ? `${entry.entityType} ${entry.entityId}` : entry.entityType,
    ip: entry.ip ?? '—',
    userAgent: entry.userAgent,
    details: entry.metadata ? JSON.stringify(entry.metadata, null, 2) : null,
  };
}

/** /system/audit: every audited event, newest first, filtered by action. */
export function useSystemAudit() {
  const [action, setAction] = useState('');
  const filters = { action: action || undefined };
  const list = useInfiniteQuery({
    queryKey: queryKeys.system.audit(filters),
    queryFn: ({ pageParam }) =>
      api.get(`/system/audit-logs${toSearch({ ...filters, cursor: pageParam, limit: '50' })}`, {
        schema: systemAuditListResponseSchema,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 15_000,
  });

  return {
    filters: { action, setAction, options: AUDIT_ACTION_OPTIONS },
    list: list.isPending
      ? ({ status: 'loading' } as const)
      : list.isError
        ? ({ status: 'error', retry: () => void list.refetch() } as const)
        : ({
            status: 'ready',
            rows: (list.data?.pages.flatMap((page) => page.items) ?? []).map(toRow),
            hasMore: list.hasNextPage,
            loadMore: () => void list.fetchNextPage(),
            isLoadingMore: list.isFetchingNextPage,
          } as const),
  };
}

export type SystemAuditModel = ReturnType<typeof useSystemAudit>;
