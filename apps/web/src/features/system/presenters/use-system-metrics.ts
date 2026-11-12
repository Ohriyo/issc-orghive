import { useRef } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  METRICS_RANGES,
  metricsRangeSchema,
  systemMetricsSchema,
  type MetricsRange,
  type SystemMetrics,
} from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatBytes, formatMs, formatPercent } from './health-format';
import { formatCount, formatDateTime } from './system-format';

/** The open page reads the latest minutes again this often. */
export const METRICS_REFRESH_MS = 60_000;

export const RANGE_LABELS: Record<MetricsRange, string> = {
  '1h': 'Last hour',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
};

/** One chart: its points (null is a gap), and how its values read. */
export interface ChartModel {
  id: string;
  title: string;
  /** What the chart shows, for screen readers and as the figure's caption. */
  description: string;
  kind: 'line' | 'area' | 'bar';
  points: { label: string; value: number | null }[];
  format: (value: number) => string;
  /** The newest value, or "No data". */
  latest: string;
}

export interface MetricsTile {
  label: string;
  value: string;
  detail: string;
  attention: boolean;
}

export type SystemMetricsState =
  | { status: 'loading'; range: MetricsRange; setRange: (r: MetricsRange) => void }
  | { status: 'error'; range: MetricsRange; setRange: (r: MetricsRange) => void; retry: () => void }
  | {
      status: 'ready';
      range: MetricsRange;
      setRange: (r: MetricsRange) => void;
      ranges: { value: MetricsRange; label: string }[];
      tiles: MetricsTile[];
      charts: ChartModel[];
      endpoints: {
        route: string;
        requests: string;
        avg: string;
        p95: string;
        max: string;
        slow: boolean;
      }[];
      queries: { at: string; route: string; duration: string; query: string }[];
      hasTraffic: boolean;
      generatedAt: string;
      isRefreshing: boolean;
    };

const manilaTime = new Intl.DateTimeFormat('en-PH', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Manila',
});
const manilaDayHour = new Intl.DateTimeFormat('en-PH', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  hour12: false,
  timeZone: 'Asia/Manila',
});
const manilaDay = new Intl.DateTimeFormat('en-PH', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'Asia/Manila',
});

const SLOW_ROUTE_MS = 1_000;

const latestOf = (points: { value: number | null }[], format: (v: number) => string) => {
  const last = [...points].reverse().find((p) => p.value !== null);
  return last?.value === null || last === undefined ? 'No data' : format(last.value);
};

/** Shapes GET /system/metrics into tiles, charts and tables. */
export function toMetricsView(metrics: SystemMetrics) {
  const label = (iso: string) =>
    metrics.range === '7d' ? manilaDayHour.format(new Date(iso)) : manilaTime.format(new Date(iso));
  const series = (pick: (p: SystemMetrics['points'][number]) => number | null) =>
    metrics.points.map((p) => ({ label: label(p.at), value: pick(p) }));

  const chart = (
    c: Omit<ChartModel, 'latest' | 'points'> & { points: ChartModel['points'] },
  ): ChartModel => ({ ...c, latest: latestOf(c.points, c.format) });

  const perMinute = (v: number) => `${formatCount(Math.round(v * 10) / 10)}/min`;
  const { totals } = metrics;

  return {
    tiles: [
      {
        label: 'Requests',
        value: formatCount(totals.requests),
        detail: RANGE_LABELS[metrics.range],
        attention: false,
      },
      {
        label: 'Server errors',
        value: totals.errorRate === null ? 'None' : formatPercent(totals.errorRate),
        detail: 'Share answered 5xx',
        attention: totals.errorRate !== null && totals.errorRate > 0.05,
      },
      {
        label: 'p95 response time',
        value: totals.p95Ms === null ? 'No data' : formatMs(totals.p95Ms),
        detail: '95% of requests were this fast or faster',
        attention: totals.p95Ms !== null && totals.p95Ms > 2_000,
      },
    ],
    charts: [
      chart({
        id: 'requests',
        title: 'Requests per minute',
        description: 'Requests the API answered each minute, averaged over each point.',
        kind: 'area',
        points: series((p) => p.requestsPerMinute),
        format: perMinute,
      }),
      chart({
        id: 'p95',
        title: 'p95 response time',
        description: 'How long the slowest 5% of requests took. Alerts above 2 s.',
        kind: 'line',
        points: series((p) => p.p95Ms),
        format: formatMs,
      }),
      chart({
        id: 'errors',
        title: 'Server error rate',
        description: 'Share of requests that failed with a server error. Alerts above 5%.',
        kind: 'line',
        points: series((p) => p.errorRate),
        format: formatPercent,
      }),
      chart({
        id: 'queue',
        title: 'Queue depth',
        description: 'Background jobs waiting across every queue.',
        kind: 'area',
        points: series((p) => p.queueWaiting),
        format: (v) => formatCount(Math.round(v)),
      }),
      chart({
        id: 'storage',
        title: 'Storage',
        description: 'Bytes of stored originals, every version included.',
        kind: 'line',
        points: series((p) => p.storageBytes),
        format: formatBytes,
      }),
      chart({
        id: 'users',
        title: 'Active accounts per day',
        description:
          'Accounts that signed in or stayed signed in, per Manila day, the last 7 days.',
        kind: 'bar',
        points: metrics.activeUsers.map((d) => ({
          label: manilaDay.format(new Date(`${d.day}T12:00:00+08:00`)),
          value: d.users,
        })),
        format: (v) => formatCount(Math.round(v)),
      }),
    ],
    endpoints: metrics.slowestEndpoints.map((e) => ({
      route: e.route,
      requests: formatCount(e.requests),
      avg: formatMs(e.avgMs),
      p95: formatMs(e.p95Ms),
      max: formatMs(e.maxMs),
      slow: e.p95Ms >= SLOW_ROUTE_MS,
    })),
    queries: metrics.slowQueries.map((q) => ({
      at: formatDateTime(q.at),
      route: q.route,
      duration: formatMs(q.durationMs),
      query: q.query,
    })),
    hasTraffic: totals.requests > 0,
    generatedAt: formatDateTime(metrics.generatedAt),
  };
}

/**
 * /system/metrics: charts over the last hour, day or week (kept in the address, so a link
 * opens the same range). Refreshes every minute in the background, like /system/health.
 */
export function useSystemMetrics(): SystemMetricsState {
  const [params, setParams] = useSearchParams();
  const parsed = metricsRangeSchema.safeParse(params.get('range'));
  const range: MetricsRange = parsed.success ? parsed.data : '1h';
  const setRange = (next: MetricsRange) =>
    setParams(next === '1h' ? {} : { range: next }, { replace: true });

  const loaded = useRef(false);
  const query = useQuery({
    queryKey: queryKeys.system.metrics(range),
    queryFn: async () => {
      const result = await api.get(`/system/metrics?range=${range}`, {
        schema: systemMetricsSchema,
        background: loaded.current,
      });
      loaded.current = true;
      return result;
    },
    staleTime: 30_000,
    refetchInterval: METRICS_REFRESH_MS,
    // Switching range keeps the old charts up until the new ones arrive.
    placeholderData: keepPreviousData,
  });

  if (query.isPending) return { status: 'loading', range, setRange };
  if (query.isError) {
    return { status: 'error', range, setRange, retry: () => void query.refetch() };
  }
  return {
    status: 'ready',
    range,
    setRange,
    ranges: METRICS_RANGES.map((value) => ({ value, label: RANGE_LABELS[value] })),
    ...toMetricsView(query.data),
    isRefreshing: query.isFetching,
  };
}
