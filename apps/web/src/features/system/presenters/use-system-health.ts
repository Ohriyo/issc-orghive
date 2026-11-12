import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  systemHealthSchema,
  type HealthCheckId,
  type HealthStatus,
  type SystemHealth,
} from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatBytes, formatFact, STATUS_LABELS } from './health-format';
import { formatCount, formatDateTime } from './system-format';

/** How often the open page checks again. */
export const HEALTH_REFRESH_MS = 30_000;

const NAMES: Record<HealthCheckId, string> = {
  api: 'API',
  postgres: 'PostgreSQL',
  redis: 'Redis',
  storage: 'Object storage',
  worker: 'Background worker',
  clamav: 'ClamAV',
  email: 'Email (SMTP)',
  disk: 'Disk space',
};

export interface HealthCard {
  id: HealthCheckId;
  name: string;
  status: HealthStatus;
  statusLabel: string;
  summary: string;
  checkedAt: string;
  facts: { label: string; value: string }[];
}

export interface StorageRow {
  slug: string;
  acronym: string;
  name: string;
  size: string;
  files: string;
  /** 0 to 1 of the largest organization, for the bar. */
  share: number;
}

export type SystemHealthState =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | {
      status: 'ready';
      overall: HealthStatus;
      headline: string;
      cards: HealthCard[];
      storage: StorageRow[];
      generatedAt: string;
      refresh: () => void;
      isRefreshing: boolean;
    };

const HEADLINES: Record<HealthStatus, string> = {
  ok: 'Everything is running.',
  warn: 'Running, but something needs a look.',
  down: 'Something is down.',
};

/** Shapes GET /system/health for the page. */
export function toHealthView(health: SystemHealth) {
  const largest = Math.max(1, ...health.storageByOrganization.map((o) => o.bytes));
  const problems = health.checks.filter((c) => c.status !== 'ok').length;
  return {
    overall: health.status,
    headline:
      problems > 0
        ? `${HEADLINES[health.status]} ${problems} of ${health.checks.length} checks need attention.`
        : HEADLINES[health.status],
    cards: health.checks.map((check) => ({
      id: check.id,
      name: NAMES[check.id],
      status: check.status,
      statusLabel: STATUS_LABELS[check.status],
      summary: check.summary,
      checkedAt: formatDateTime(check.checkedAt),
      facts: check.facts.map((fact) => ({ label: fact.label, value: formatFact(fact) })),
    })),
    storage: health.storageByOrganization.map((o) => ({
      slug: o.slug,
      acronym: o.acronym,
      name: o.name,
      size: formatBytes(o.bytes),
      files: formatCount(o.files),
      share: o.bytes / largest,
    })),
    generatedAt: formatDateTime(health.generatedAt),
  };
}

/**
 * /system/health: live checks, refreshed every 30 seconds. Only the first read is a page
 * view (audited); the refreshes are background reads, so an open tab neither fills the
 * audit log nor keeps an idle session alive.
 */
export function useSystemHealth(): SystemHealthState {
  const loaded = useRef(false);
  const query = useQuery({
    queryKey: queryKeys.system.health,
    queryFn: async () => {
      const result = await api.get('/system/health', {
        schema: systemHealthSchema,
        background: loaded.current,
      });
      loaded.current = true;
      return result;
    },
    staleTime: 10_000,
    refetchInterval: HEALTH_REFRESH_MS,
  });
  if (query.isPending) return { status: 'loading' };
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  return {
    status: 'ready',
    ...toHealthView(query.data),
    refresh: () => void query.refetch(),
    isRefreshing: query.isFetching,
  };
}
