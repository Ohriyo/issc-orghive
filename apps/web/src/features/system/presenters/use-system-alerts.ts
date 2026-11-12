import { useQuery } from '@tanstack/react-query';
import { systemAlertsSchema } from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatDateTime } from './system-format';

export interface AlertItem {
  id: string;
  message: string;
  since: string;
}

/**
 * Open system alerts, for the banner on every console page. A background read every minute:
 * never audited as a page view, and not session activity.
 */
export function useSystemAlerts(): AlertItem[] {
  const query = useQuery({
    queryKey: queryKeys.system.alerts,
    queryFn: () => api.get('/system/alerts', { schema: systemAlertsSchema, background: true }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return (query.data?.alerts ?? []).map((alert) => ({
    id: alert.id,
    message: alert.message,
    since: formatDateTime(alert.openedAt),
  }));
}
