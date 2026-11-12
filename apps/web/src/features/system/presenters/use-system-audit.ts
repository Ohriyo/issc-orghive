import { useEffect, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  adminOrganizationTreeSchema,
  AUDIT_EXPORT_MAX_ROWS,
  AUDIT_EXPORT_TRUNCATED_HEADER,
  systemAuditListResponseSchema,
  type AdminOrganizationTree,
  type SystemAuditEntry,
} from '@orghive/shared';
import { api, apiGetFile } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { actionLabel, formatCount, formatDateTime, messageOf, toSearch } from './system-format';

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
  'system_setting_change',
  'queue_job_retry',
  'queue_job_remove',
  'queue_pause',
  'queue_resume',
  'cache_flush',
  'email_test',
  'audit_export',
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
  /** The officer who acted for a shared organization account, when recorded. */
  actingAs: string | null;
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
    actingAs: entry.actingAs,
    target: entry.entityId ? `${entry.entityType} ${entry.entityId}` : entry.entityType,
    ip: entry.ip ?? '—',
    userAgent: entry.userAgent,
    details: entry.metadata ? JSON.stringify(entry.metadata, null, 2) : null,
  };
}

/** Every organization, ISSC first, then each college's CSC and SBOs, for the filter. */
export function organizationOptions(tree: AdminOrganizationTree) {
  const options = tree.issc ? [{ value: tree.issc.slug, label: tree.issc.acronym }] : [];
  for (const college of tree.colleges) {
    for (const org of [...(college.csc ? [college.csc] : []), ...college.sbos]) {
      options.push({ value: org.slug, label: `${org.acronym} (${college.code})` });
    }
  }
  return options;
}

/** A Manila calendar day (YYYY-MM-DD) as the UTC instant it starts or ends. */
export function manilaDayBound(day: string, end: boolean): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const at = new Date(`${day}T${end ? '23:59:59.999' : '00:00:00.000'}+08:00`);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

/** Saves a downloaded file under its name. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const filenameOf = (headers: Headers) =>
  /filename="([^"]+)"/.exec(headers.get('Content-Disposition') ?? '')?.[1] ?? 'orghive-audit.csv';

const SEARCH_DELAY_MS = 300;

/** A text filter the API is asked about once typing pauses, not on every key. */
function useDebounced(value: string) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}

/**
 * /system/audit: every audited event, newest first, filtered by action, organization, actor,
 * "Acting as" and Manila dates, and exported as CSV with the same filters.
 */
export function useSystemAudit() {
  const [action, setAction] = useState('');
  const [organization, setOrganization] = useState('');
  const [actorInput, setActor] = useState('');
  const [actingAsInput, setActingAs] = useState('');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const actor = useDebounced(actorInput);
  const actingAs = useDebounced(actingAsInput);

  const from = manilaDayBound(fromDay, false);
  const to = manilaDayBound(toDay, true);
  const dateError = from && to && from > to ? 'The start date is after the end date.' : null;

  const filters = {
    action: action || undefined,
    organization: organization || undefined,
    actor: actor || undefined,
    actingAs: actingAs || undefined,
    from,
    to,
  };

  const organizations = useQuery({
    queryKey: queryKeys.system.organizations,
    queryFn: () => api.get('/system/organizations', { schema: adminOrganizationTreeSchema }),
    staleTime: 5 * 60_000,
  });

  const list = useInfiniteQuery({
    queryKey: queryKeys.system.audit(filters),
    queryFn: ({ pageParam }) =>
      api.get(`/system/audit-logs${toSearch({ ...filters, cursor: pageParam, limit: '50' })}`, {
        schema: systemAuditListResponseSchema,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !dateError,
    staleTime: 15_000,
  });

  const exportCsv = useMutation({
    mutationFn: () => apiGetFile(`/system/audit-logs/export${toSearch(filters)}`),
    onSuccess: ({ blob, headers }) => {
      saveBlob(blob, filenameOf(headers));
      if (headers.get(AUDIT_EXPORT_TRUNCATED_HEADER) === '1') {
        toast.warning(
          `Only the newest ${formatCount(AUDIT_EXPORT_MAX_ROWS)} matching events were exported. Narrow the filters for the rest.`,
        );
      } else {
        toast.success('Audit log exported');
      }
    },
    onError: (error) => toast.error(messageOf(error)),
  });

  const filtered = Object.values(filters).some(Boolean);
  const clear = () => {
    setAction('');
    setOrganization('');
    setActor('');
    setActingAs('');
    setFromDay('');
    setToDay('');
  };

  return {
    filters: {
      action,
      setAction,
      options: AUDIT_ACTION_OPTIONS,
      organization,
      setOrganization,
      organizationOptions: organizations.data ? organizationOptions(organizations.data) : [],
      actor: actorInput,
      setActor,
      actingAs: actingAsInput,
      setActingAs,
      fromDay,
      setFromDay,
      toDay,
      setToDay,
      dateError,
      filtered,
      clear,
    },
    export: {
      run: () => exportCsv.mutate(),
      running: exportCsv.isPending,
      disabled: Boolean(dateError),
    },
    list: dateError
      ? ({ status: 'invalid', message: dateError } as const)
      : list.isPending
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
