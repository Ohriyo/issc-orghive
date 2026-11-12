import { lazy, Suspense } from 'react';
import type { MetricsRange } from '@orghive/shared';
import { SectionError } from '@/components/section-error';
import { cn } from '@/lib/utils';
import { RANGE_LABELS, type SystemMetricsState } from '../presenters/use-system-metrics';

/**
 * Recharts is loaded only here, when the charts are drawn, so the rest of the console never
 * downloads it.
 */
const MetricsChart = lazy(async () => ({
  default: (await import('./metrics-chart')).MetricsChart,
}));

/** A chart's place while Recharts loads: the same size, so nothing jumps. */
function ChartPlaceholder({ title }: { title: string }) {
  return (
    <div className="flex h-[19rem] flex-col gap-3 rounded-xl bg-white p-5 ring-1 ring-border">
      <span className="text-body-lg font-semibold text-ink">{title}</span>
      <div
        aria-hidden="true"
        className="flex-1 animate-pulse rounded-lg bg-surface motion-reduce:animate-none"
      />
    </div>
  );
}
import { SystemLoading } from './system-layout';

const PANEL = 'rounded-xl bg-white ring-1 ring-border';

/** 1 h / 24 h / 7 d, as a group of toggle buttons (each 44 px tall). */
export function RangePicker({
  range,
  onChange,
}: {
  range: MetricsRange;
  onChange: (range: MetricsRange) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Time range"
      className="inline-flex rounded-full bg-white p-1 ring-1 ring-border"
    >
      {(Object.keys(RANGE_LABELS) as MetricsRange[]).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={range === value}
          onClick={() => onChange(value)}
          className={cn(
            'min-h-11 min-w-14 rounded-full px-4 text-body font-medium text-ink-muted transition-colors duration-300',
            'hover:text-ink focus-visible:text-ink',
            'aria-pressed:bg-ink aria-pressed:text-white',
          )}
        >
          <span aria-hidden="true">{value}</span>
          <span className="sr-only">{RANGE_LABELS[value]}</span>
        </button>
      ))}
    </div>
  );
}

/** /system/metrics: three numbers, six charts, then the slowest routes and queries. */
export function MetricsView({ state }: { state: SystemMetricsState }) {
  if (state.status === 'loading') return <SystemLoading label="Loading the metrics" />;
  if (state.status === 'error') {
    return <SectionError message="The metrics could not be loaded." onRetry={state.retry} />;
  }

  return (
    <div className="flex flex-col gap-8" aria-busy={state.isRefreshing}>
      <dl className="grid gap-3 sm:grid-cols-3">
        {state.tiles.map((tile) => (
          <div key={tile.label} className={cn(PANEL, 'flex flex-col gap-1 p-5')}>
            <dt className="text-small font-medium text-ink-muted">{tile.label}</dt>
            <dd
              className={cn(
                'text-h2 font-bold tabular-nums',
                tile.attention ? 'text-caution' : 'text-ink',
              )}
            >
              {tile.value}
            </dd>
            <dd className="text-small text-ink-muted">{tile.detail}</dd>
          </div>
        ))}
      </dl>

      {!state.hasTraffic ? (
        <p className={cn(PANEL, 'px-5 py-4 text-body text-ink-muted')}>
          No requests recorded in this range yet. The API saves a snapshot every minute, so new
          numbers appear within a minute or two.
        </p>
      ) : null}

      <section aria-labelledby="charts-heading">
        <h2 id="charts-heading" className="sr-only">
          Charts
        </h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {state.charts.map((chart) => (
            <Suspense key={chart.id} fallback={<ChartPlaceholder title={chart.title} />}>
              <MetricsChart chart={chart} />
            </Suspense>
          ))}
        </div>
      </section>

      <section aria-labelledby="endpoints-heading">
        <h2 id="endpoints-heading" className="mb-1 text-h3 font-bold text-ink">
          Slowest endpoints
        </h2>
        <p className="mb-3 text-small text-ink-muted">By p95 response time, in this range.</p>
        {state.endpoints.length === 0 ? (
          <p className={cn(PANEL, 'px-5 py-6 text-body text-ink-muted')}>No requests yet.</p>
        ) : (
          <div
            className={cn(PANEL, 'overflow-x-auto')}
            tabIndex={0}
            role="region"
            aria-labelledby="endpoints-heading"
          >
            <table className="w-full min-w-[40rem] text-left text-body">
              <caption className="sr-only">Endpoints by p95 response time, slowest first</caption>
              <thead>
                <tr className="border-b border-border text-small text-ink-muted">
                  <th scope="col" className="px-5 py-3 font-medium">
                    Route
                  </th>
                  {['Requests', 'Average', 'p95', 'Slowest'].map((h) => (
                    <th key={h} scope="col" className="px-5 py-3 text-right font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {state.endpoints.map((e) => (
                  <tr key={e.route}>
                    <th
                      scope="row"
                      className="px-5 py-3 font-mono text-small font-medium break-all text-ink"
                    >
                      {e.route}
                    </th>
                    <td className="px-5 py-3 text-right tabular-nums">{e.requests}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{e.avg}</td>
                    <td
                      className={cn(
                        'px-5 py-3 text-right tabular-nums',
                        e.slow && 'font-semibold text-caution',
                      )}
                    >
                      {e.p95}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">{e.max}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="queries-heading">
        <h2 id="queries-heading" className="mb-1 text-h3 font-bold text-ink">
          Slow database queries
        </h2>
        <p className="mb-3 text-small text-ink-muted">
          Queries over 500 ms, with the route that ran them. Only the SQL is kept, never the values.
        </p>
        {state.queries.length === 0 ? (
          <p className={cn(PANEL, 'px-5 py-6 text-body text-ink-muted')}>
            No query took over 500 ms in this range.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {state.queries.map((q, i) => (
              <li key={`${q.at}-${i}`} className={cn(PANEL, 'flex min-w-0 flex-col gap-2 p-5')}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-mono text-small font-medium break-all text-ink">
                    {q.route}
                  </span>
                  <span className="text-small text-ink-muted">
                    <span className="font-semibold text-caution tabular-nums">{q.duration}</span> ·{' '}
                    {q.at}
                  </span>
                </div>
                {/* Scrolls sideways on phones: focusable, so the keyboard can scroll it too. */}
                <pre
                  tabIndex={0}
                  aria-label={`SQL of the ${q.duration} query`}
                  className="overflow-x-auto rounded-lg bg-surface px-3 py-2 font-mono text-small text-ink focus-visible:ring-2 focus-visible:ring-ink"
                >
                  <code>{q.query}</code>
                </pre>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-small text-ink-muted">
        As of {state.generatedAt}, Manila time. Kept for 7 days.
      </p>
    </div>
  );
}
