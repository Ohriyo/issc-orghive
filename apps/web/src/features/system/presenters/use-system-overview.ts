import { useQuery } from '@tanstack/react-query';
import { systemOverviewSchema } from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatCount, formatDateTime } from './system-format';

export interface OverviewStat {
  label: string;
  value: string;
  /** One line of context under the number. */
  detail: string;
  /** Needs a look: shown in the warning colour. */
  attention: boolean;
}

export interface QueueRow {
  name: string;
  waiting: string;
  active: string;
  delayed: string;
  failed: string;
  attention: boolean;
}

export type SystemOverviewState =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | {
      status: 'ready';
      stats: OverviewStat[];
      documents: { label: string; value: string; attention: boolean }[];
      queues: QueueRow[];
      generatedAt: string;
      refresh: () => void;
      isRefreshing: boolean;
    };

/** /system/overview: counts across the system, and what may need attention. */
export function useSystemOverview(): SystemOverviewState {
  const query = useQuery({
    queryKey: queryKeys.system.overview,
    queryFn: () => api.get('/system/overview', { schema: systemOverviewSchema }),
    staleTime: 60_000,
  });
  if (query.isPending) return { status: 'loading' };
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };

  const o = query.data;
  return {
    status: 'ready',
    stats: [
      {
        label: 'Users',
        value: formatCount(o.users.total),
        detail: `${formatCount(o.users.active)} active, ${formatCount(o.users.disabled)} deactivated`,
        attention: false,
      },
      {
        label: 'Super admins',
        value: formatCount(o.superAdmins.active),
        detail:
          o.superAdmins.pendingMfa > 0
            ? `${formatCount(o.superAdmins.pendingMfa)} still setting up MFA`
            : 'All with MFA',
        attention: o.superAdmins.active < 2,
      },
      {
        label: 'Organizations',
        value: formatCount(o.organizations.total),
        detail: `${formatCount(o.organizations.active)} active`,
        attention: false,
      },
      {
        label: 'Failed sign-ins, 24 h',
        value: formatCount(o.failedLoginsLast24h),
        detail: `${formatCount(o.auditEventsLast24h)} audit events in the same time`,
        attention: o.failedLoginsLast24h >= 20,
      },
    ],
    documents: [
      { label: 'Available', value: formatCount(o.documents.available), attention: false },
      { label: 'Scanning', value: formatCount(o.documents.scanning), attention: false },
      {
        label: 'Stuck scanning (15+ min)',
        value: formatCount(o.documents.stuckScanning),
        attention: o.documents.stuckScanning > 0,
      },
      {
        label: 'Quarantined',
        value: formatCount(o.documents.quarantined),
        attention: false,
      },
      { label: 'Archived', value: formatCount(o.documents.archived), attention: false },
    ],
    queues: o.queues.map((q) => ({
      name: q.name.charAt(0).toUpperCase() + q.name.slice(1),
      waiting: formatCount(q.waiting),
      active: formatCount(q.active),
      delayed: formatCount(q.delayed),
      failed: formatCount(q.failed),
      attention: q.failed > 0,
    })),
    generatedAt: formatDateTime(o.generatedAt),
    refresh: () => void query.refetch(),
    isRefreshing: query.isFetching,
  };
}
