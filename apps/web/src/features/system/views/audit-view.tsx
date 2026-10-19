import { SelectField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { TextField } from '@/components/text-field';
import { SectionError } from '@/components/section-error';
import type { SystemAuditModel } from '../presenters/use-system-audit';
import { SystemLoading } from './system-layout';

/**
 * /system/audit: one row per event. Details (before and after values, routes, user agent)
 * open in place, so the list stays dense.
 */
export function AuditView({ model }: { model: SystemAuditModel }) {
  const { filters, list } = model;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <SelectField
          label="Action"
          className="sm:max-w-xs sm:flex-1"
          placeholder="All actions"
          options={filters.options}
          value={filters.action}
          onChange={(event) => filters.setAction(event.target.value)}
        />
        <TextField
          label="Acting as"
          type="search"
          className="min-w-0 sm:max-w-xs sm:flex-1"
          placeholder="Part of a name"
          maxLength={80}
          value={filters.actingAs}
          onChange={(event) => filters.setActingAs(event.target.value)}
        />
      </div>

      {list.status === 'loading' ? (
        <SystemLoading label="Loading the audit log" />
      ) : list.status === 'error' ? (
        <SectionError message="The audit log could not be loaded." onRetry={list.retry} />
      ) : list.rows.length === 0 ? (
        <p className="rounded-xl bg-white px-5 py-6 text-body text-ink-muted ring-1 ring-border">
          No events for this filter yet.
        </p>
      ) : (
        <>
          <ol
            aria-label="Audit events"
            className="divide-y divide-border rounded-xl bg-white ring-1 ring-border"
          >
            {list.rows.map((row) => (
              <li key={row.id} className="px-5 py-3">
                <div className="grid gap-x-6 gap-y-1 sm:grid-cols-[10.5rem_minmax(0,1fr)] lg:grid-cols-[10.5rem_11rem_minmax(0,1fr)_9rem]">
                  <span className="text-small whitespace-nowrap text-ink-muted tabular-nums">
                    {row.when}
                  </span>
                  <span className="text-body font-semibold text-ink">{row.action}</span>
                  <span className="min-w-0 text-body break-words text-ink sm:col-span-2 lg:col-span-1">
                    {row.actor}
                    {row.actingAs ? (
                      <span className="block text-small text-ink">acting as {row.actingAs}</span>
                    ) : null}
                    <span className="block text-small break-all text-ink-muted">{row.target}</span>
                  </span>
                  <span className="text-small break-all text-ink-muted tabular-nums sm:col-span-2 lg:col-span-1 lg:text-right">
                    {row.ip}
                  </span>
                </div>
                {row.details || row.userAgent ? (
                  <details className="mt-2 text-small">
                    <summary className="tap-area w-fit cursor-pointer rounded-sm font-medium text-ink underline decoration-transparent underline-offset-4 hover:decoration-ink focus-visible:decoration-ink">
                      Details
                    </summary>
                    {row.userAgent ? (
                      <p className="mt-2 break-all text-ink-muted">{row.userAgent}</p>
                    ) : null}
                    {row.details ? (
                      <pre
                        tabIndex={0}
                        className="mt-2 overflow-x-auto rounded-lg bg-surface p-3 font-mono text-small text-ink focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        {row.details}
                      </pre>
                    ) : null}
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
          {list.hasMore ? (
            <PillButton
              variant="light"
              className="self-center"
              onClick={list.loadMore}
              disabled={list.isLoadingMore}
            >
              {list.isLoadingMore ? 'Loading…' : 'Show older events'}
            </PillButton>
          ) : null}
        </>
      )}
    </div>
  );
}
