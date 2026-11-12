import { Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import { SelectField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { cn } from '@/lib/utils';
import type { QueueJobState } from '@orghive/shared';
import type { QueueManagerModel } from '../presenters/use-queue-manager';
import { ConfirmDialog, SECONDARY, StepUpDialog } from './system-dialogs';
import { SystemLoading } from './system-layout';

type Ready = Extract<QueueManagerModel, { status: 'ready' }>;

const PANEL = 'rounded-xl bg-white ring-1 ring-border';

export function QueuesRefreshButton({ model }: { model: QueueManagerModel }) {
  if (model.status !== 'ready') return null;
  return (
    <PillButton variant="light" onClick={model.refresh} disabled={model.isRefreshing}>
      <RotateCw aria-hidden="true" className={cn(model.isRefreshing && 'animate-spin')} />
      Refresh
    </PillButton>
  );
}

/** /system/queues: pick a queue, then see and act on its jobs. */
export function QueuesView({ model }: { model: QueueManagerModel }) {
  if (model.status === 'loading') return <SystemLoading label="Loading the queues" />;
  if (model.status === 'error') {
    return (
      <SectionError
        message="The queues could not be loaded. The API may not reach Redis."
        onRetry={model.retry}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="queue-list-heading">
        <h2 id="queue-list-heading" className="sr-only">
          Queues
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {model.queues.map((queue) => {
            const current = model.selected?.name === queue.name;
            return (
              <li key={queue.name}>
                <button
                  type="button"
                  aria-pressed={current}
                  onClick={() => model.select(queue.name)}
                  className={cn(
                    PANEL,
                    'flex h-full w-full cursor-pointer flex-col gap-2 p-4 text-left transition-shadow duration-300',
                    'hover:ring-forest-500 focus-visible:outline-2 focus-visible:outline-ring',
                    current && 'ring-2 ring-forest-700',
                  )}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-body font-semibold text-ink">{queue.name}</span>
                    {queue.paused ? (
                      <span className="rounded-full bg-caution-surface px-2 py-0.5 text-caption font-semibold text-caution">
                        Paused
                      </span>
                    ) : null}
                  </span>
                  <span className="text-small text-ink-muted">{queue.purpose}</span>
                  <span className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-1 text-small text-ink-muted">
                    {queue.counts.map((count) => (
                      <span
                        key={count.state}
                        className={cn(
                          count.state === 'failed' &&
                            queue.attention &&
                            'font-semibold text-caution',
                        )}
                      >
                        {count.label} <span className="tabular-nums text-ink">{count.value}</span>
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-small text-ink-muted">As of {model.generatedAt}, Manila time.</p>
      </section>

      {model.selected ? <QueueJobs model={model} /> : null}

      <ConfirmDialog confirming={model.confirming} onCancel={model.cancelConfirm} />
      <StepUpDialog {...model.stepUp} />
    </div>
  );
}

function QueueJobs({ model }: { model: Ready }) {
  const queue = model.selected!;
  const { jobs } = model;
  return (
    <section aria-labelledby="queue-jobs-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 id="queue-jobs-heading" className="text-h3 font-bold text-ink">
            {queue.name}
            {queue.paused ? <span className="font-normal text-caution"> (paused)</span> : null}
          </h2>
          <p className="text-small text-ink-muted">{queue.purpose}</p>
        </div>
        <PillButton variant="light" onClick={model.askTogglePause} disabled={model.pausing}>
          {queue.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
          {queue.paused ? 'Resume queue' : 'Pause queue'}
        </PillButton>
      </div>

      <SelectField
        label="Jobs"
        className="sm:max-w-xs"
        options={model.stateOptions}
        value={model.state}
        onChange={(event) => model.setState(event.target.value as QueueJobState)}
      />

      {jobs.status === 'loading' ? (
        <SystemLoading label="Loading jobs" />
      ) : jobs.status === 'error' ? (
        <SectionError message="The jobs could not be loaded." onRetry={jobs.retry} />
      ) : jobs.rows.length === 0 ? (
        <p className={cn(PANEL, 'px-5 py-6 text-body text-ink-muted')}>
          No {model.stateLabel.toLowerCase()} jobs in {queue.name}.
        </p>
      ) : (
        <>
          <p aria-live="polite" className="text-body font-medium text-ink">
            {jobs.total === 1 ? '1 job' : `${jobs.total} jobs`}
          </p>
          <ol
            aria-label={`${model.stateLabel} jobs`}
            className={cn(PANEL, 'divide-y divide-border')}
          >
            {jobs.rows.map((job) => (
              <li key={job.id} className="flex flex-col gap-2 px-5 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-body font-semibold text-ink">{job.name}</p>
                    <p className="text-small break-words text-ink-muted">
                      Job {job.id} · {job.attempts} · queued {job.queued}
                      {job.finished ? ` · ended ${job.finished}` : ''}
                    </p>
                  </div>
                  {model.canActOnJobs ? (
                    <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2">
                      <PillButton
                        variant="light"
                        onClick={() => model.retry(job.id)}
                        disabled={model.busyJobId === job.id}
                        aria-label={`Retry job ${job.id}`}
                      >
                        <RotateCcw aria-hidden="true" />
                        Retry
                      </PillButton>
                      <button
                        type="button"
                        className={SECONDARY}
                        onClick={() => model.askRemove(job.id)}
                        disabled={model.busyJobId === job.id}
                        aria-label={`Remove job ${job.id}`}
                      >
                        Remove
                      </button>
                    </div>
                  ) : null}
                </div>
                {job.failedReason ? (
                  <pre
                    tabIndex={0}
                    className="overflow-x-auto rounded-lg bg-caution-surface p-3 font-mono text-small whitespace-pre-wrap text-ink focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {job.failedReason}
                  </pre>
                ) : null}
                <details className="text-small">
                  <summary className="tap-area w-fit cursor-pointer rounded-sm font-medium text-ink underline decoration-transparent underline-offset-4 hover:decoration-ink focus-visible:decoration-ink">
                    Job data
                  </summary>
                  <pre
                    tabIndex={0}
                    className="mt-2 overflow-x-auto rounded-lg bg-surface p-3 font-mono text-small text-ink focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {job.data}
                  </pre>
                </details>
              </li>
            ))}
          </ol>
          {jobs.pageCount > 1 ? (
            <nav
              aria-label="Job pages"
              className="flex flex-wrap items-center justify-center gap-4"
            >
              <PillButton variant="light" onClick={jobs.previous} disabled={!jobs.canPrevious}>
                Previous
              </PillButton>
              <span className="text-small text-ink-muted tabular-nums">
                Page {jobs.page + 1} of {jobs.pageCount}
              </span>
              <PillButton variant="light" onClick={jobs.next} disabled={!jobs.canNext}>
                Next
              </PillButton>
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
