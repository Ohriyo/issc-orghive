import { CircleAlert, CircleCheck, CircleX, RotateCw } from 'lucide-react';
import type { HealthStatus } from '@orghive/shared';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { cn } from '@/lib/utils';
import type { SystemHealthState } from '../presenters/use-system-health';
import { SystemLoading } from './system-layout';

const PANEL = 'rounded-xl bg-white ring-1 ring-border';

const STATUS_STYLES: Record<HealthStatus, { badge: string; icon: typeof CircleCheck }> = {
  ok: { badge: 'bg-surface text-ink ring-1 ring-border', icon: CircleCheck },
  warn: { badge: 'bg-caution-surface text-caution', icon: CircleAlert },
  down: { badge: 'bg-destructive text-white', icon: CircleX },
};

/** A status in words and an icon, never color alone. */
export function StatusBadge({ status, label }: { status: HealthStatus; label: string }) {
  const { badge, icon: Icon } = STATUS_STYLES[status];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-small font-semibold',
        badge,
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
      {label}
    </span>
  );
}

export function HealthRefreshButton({ state }: { state: SystemHealthState }) {
  if (state.status !== 'ready') return null;
  return (
    <PillButton variant="light" onClick={state.refresh} disabled={state.isRefreshing}>
      <RotateCw
        aria-hidden="true"
        className={cn(state.isRefreshing && 'animate-spin motion-reduce:animate-none')}
      />
      Check now
    </PillButton>
  );
}

/** /system/health: one card per service, then storage per organization. */
export function HealthView({ state }: { state: SystemHealthState }) {
  if (state.status === 'loading') return <SystemLoading label="Checking every service" />;
  if (state.status === 'error') {
    return <SectionError message="The health checks could not be loaded." onRetry={state.retry} />;
  }

  const OverallIcon = STATUS_STYLES[state.overall].icon;
  return (
    <div className="flex flex-col gap-8">
      <p
        role="status"
        className={cn(
          'flex items-start gap-3 rounded-xl px-5 py-4 text-body font-medium',
          state.overall === 'ok' && 'bg-white text-ink ring-1 ring-border',
          state.overall === 'warn' && 'bg-caution-surface text-caution',
          state.overall === 'down' && 'bg-destructive text-white',
        )}
      >
        <OverallIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <span>
          {state.headline}{' '}
          <span className="font-normal">
            Checked {state.generatedAt}; it checks again every 30 seconds.
          </span>
        </span>
      </p>

      <section aria-labelledby="services-heading">
        <h2 id="services-heading" className="mb-3 text-h3 font-bold text-ink">
          Services
        </h2>
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {state.cards.map((card) => (
            <li key={card.id} className={cn(PANEL, 'flex flex-col gap-3 p-5')}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-body-lg font-semibold text-ink">{card.name}</h3>
                <StatusBadge status={card.status} label={card.statusLabel} />
              </div>
              <p className="text-body text-ink">{card.summary}</p>
              {card.facts.length > 0 ? (
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-small">
                  {card.facts.map((fact) => (
                    <div key={fact.label} className="contents">
                      <dt className="text-ink-muted">{fact.label}</dt>
                      <dd className="text-right font-medium break-words text-ink tabular-nums">
                        {fact.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              <p className="mt-auto text-caption text-ink-muted">Checked {card.checkedAt}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="storage-heading">
        <h2 id="storage-heading" className="mb-1 text-h3 font-bold text-ink">
          Storage per organization
        </h2>
        <p className="mb-3 text-small text-ink-muted">
          Every stored version of every file. Page images and logos are not counted.
        </p>
        {state.storage.length === 0 ? (
          <p className={cn(PANEL, 'px-5 py-6 text-body text-ink-muted')}>
            No organization has stored files yet.
          </p>
        ) : (
          <div
            className={cn(PANEL, 'max-h-[28rem] overflow-auto')}
            tabIndex={0}
            role="region"
            aria-labelledby="storage-heading"
          >
            <table className="w-full min-w-[22rem] text-left text-body">
              <caption className="sr-only">
                Stored bytes and files per organization, largest first
              </caption>
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-border text-small text-ink-muted">
                  <th scope="col" className="px-5 py-3 font-medium">
                    Organization
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    Size
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    Files
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {state.storage.map((row) => (
                  <tr key={row.slug}>
                    <th scope="row" className="px-5 py-3 font-medium text-ink">
                      <span title={row.name}>{row.acronym}</span>
                      <span
                        aria-hidden="true"
                        className="mt-1.5 block h-1 rounded-full bg-sage"
                        style={{ width: `${Math.max(2, Math.round(row.share * 100))}%` }}
                      />
                    </th>
                    <td className="px-5 py-3 text-right tabular-nums">{row.size}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{row.files}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
