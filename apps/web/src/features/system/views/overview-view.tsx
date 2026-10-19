import { RotateCw } from 'lucide-react';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { cn } from '@/lib/utils';
import type { SystemOverviewState } from '../presenters/use-system-overview';
import { SystemLoading } from './system-layout';

const PANEL = 'rounded-xl bg-white ring-1 ring-border';

export function RefreshButton({ state }: { state: SystemOverviewState }) {
  if (state.status !== 'ready') return null;
  return (
    <PillButton variant="light" onClick={state.refresh} disabled={state.isRefreshing}>
      <RotateCw aria-hidden="true" className={cn(state.isRefreshing && 'animate-spin')} />
      Refresh
    </PillButton>
  );
}

/** /system/overview: four headline numbers, documents by state, and the job queues. */
export function OverviewView({ state }: { state: SystemOverviewState }) {
  if (state.status === 'loading') return <SystemLoading label="Loading the overview" />;
  if (state.status === 'error') {
    return <SectionError message="The overview could not be loaded." onRetry={state.retry} />;
  }

  return (
    <div className="flex flex-col gap-8">
      <dl className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
        {state.stats.map((stat) => (
          <div key={stat.label} className={cn(PANEL, 'flex flex-col gap-1 p-5')}>
            <dt className="text-small font-medium text-ink-muted">{stat.label}</dt>
            <dd
              className={cn(
                'order-first text-h2 font-bold tabular-nums',
                stat.attention ? 'text-caution' : 'text-ink',
              )}
            >
              {stat.value}
            </dd>
            <dd className="text-small text-ink-muted">{stat.detail}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="documents-heading">
        <h2 id="documents-heading" className="mb-3 text-h3 font-bold text-ink">
          Documents
        </h2>
        <dl
          className={cn(
            PANEL,
            'grid grid-cols-1 divide-y divide-border sm:grid-cols-5 sm:divide-x sm:divide-y-0',
          )}
        >
          {state.documents.map((item) => (
            <div
              key={item.label}
              className={cn(
                'flex items-baseline justify-between gap-4 px-5 py-3 sm:flex-col sm:justify-start sm:gap-1 sm:py-4',
                item.attention && 'bg-caution-surface',
              )}
            >
              <dt className="text-small text-ink-muted">{item.label}</dt>
              <dd
                className={cn(
                  'text-h3 font-bold tabular-nums',
                  item.attention ? 'text-caution' : 'text-ink',
                )}
              >
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="queues-heading">
        <h2 id="queues-heading" className="mb-3 text-h3 font-bold text-ink">
          Background queues
        </h2>
        {state.queues.length === 0 ? (
          <p className={cn(PANEL, 'px-5 py-4 text-body text-ink-muted')}>
            Queue counts are unavailable right now. The API could not reach Redis.
          </p>
        ) : (
          // Focusable, so keyboard users can scroll it sideways on a phone.
          <div
            role="region"
            aria-labelledby="queues-heading"
            tabIndex={0}
            className={cn(
              PANEL,
              'overflow-x-auto focus-visible:outline-2 focus-visible:outline-ring',
            )}
          >
            <table className="w-full min-w-[32rem] text-left text-body">
              <caption className="sr-only">Jobs per background queue</caption>
              <thead>
                <tr className="border-b border-border text-small text-ink-muted">
                  <th scope="col" className="px-5 py-3 font-medium">
                    Queue
                  </th>
                  {['Waiting', 'Active', 'Delayed', 'Failed'].map((h) => (
                    <th key={h} scope="col" className="px-5 py-3 text-right font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {state.queues.map((q) => (
                  <tr key={q.name}>
                    <th scope="row" className="px-5 py-3 font-medium text-ink">
                      {q.name}
                    </th>
                    <td className="px-5 py-3 text-right tabular-nums">{q.waiting}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{q.active}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{q.delayed}</td>
                    <td
                      className={cn(
                        'px-5 py-3 text-right tabular-nums',
                        q.attention && 'font-semibold text-caution',
                      )}
                    >
                      {q.failed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-small text-ink-muted">As of {state.generatedAt}, Manila time.</p>
    </div>
  );
}
