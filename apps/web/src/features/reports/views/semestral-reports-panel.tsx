import { AlertTriangle, CheckCircle2, Download, FileStack, Loader2, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { SelectField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { cn } from '@/lib/utils';
import { OriginLink } from '@/navigation/origin-link';
import type { ReportItem, SemestralReportsModel } from '../presenters/use-semestral-reports';

type Ready = Extract<SemestralReportsModel, { status: 'ready' }>;

/**
 * The officer dashboard's Semestral End Report panel (docs/PROJECT_WORKFLOW_SPEC.md, 4):
 * "Generate Semestral End Report" with a semester picker, then each report's progress and,
 * once ready, its download.
 */
export function SemestralReportsPanel({
  model,
  className,
}: {
  model: SemestralReportsModel;
  className?: string;
}) {
  return (
    <section aria-labelledby="semestral-reports" className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="semestral-reports" className="text-h2 font-bold text-ink">
            Semestral End Report
          </h2>
          <p className="mt-1 max-w-prose text-body text-ink-muted">
            Every submitted project file of one semester in a single PDF: cover, contents, and each
            project’s documents in order. Only your officers can see it.
          </p>
        </div>
        {model.status === 'ready' ? <GenerateDialog model={model} /> : null}
      </div>
      {model.status === 'loading' ? (
        <div aria-busy="true">
          <span className="sr-only">Loading the reports</span>
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      ) : model.status === 'error' ? (
        <SectionError
          message="Your reports could not be loaded. Check your connection and try again."
          onRetry={model.retry}
        />
      ) : model.items.length === 0 ? (
        <p className="rounded-2xl bg-white/70 p-5 text-body text-ink-muted ring-1 ring-ink/10">
          No reports yet. Generate one when a semester’s projects are done.
        </p>
      ) : (
        <>
          {model.downloadError ? (
            <p role="alert" className="text-body font-medium text-destructive">
              {model.downloadError}
            </p>
          ) : null}
          <ul className="flex flex-col gap-3">
            {model.items.map((item) => (
              <li key={item.id}>
                <ReportRow item={item} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ReportRow({ item }: { item: ReportItem }) {
  const running = item.status === 'queued' || item.status === 'generating';
  return (
    <article
      aria-label={`${item.label} report`}
      className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-pool ring-1 ring-ink/10 md:flex-row md:items-center md:gap-6 md:p-5"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="text-body-lg font-semibold text-ink">{item.label}</h3>
        <p className="text-small text-ink-muted">{item.requested}</p>
        <div aria-live="polite" className="text-small">
          {running ? (
            <div className="mt-1 flex flex-col gap-1">
              <div
                role="progressbar"
                aria-label={`Progress of the ${item.label} report`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={item.progress}
                className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-surface-deep"
              >
                <div
                  className="bg-forest-band h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
                  style={{ width: `${item.progress}%` }}
                />
              </div>
              <span className="inline-flex items-center gap-1.5 text-ink-muted">
                <Loader2
                  aria-hidden="true"
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
                {item.status === 'queued'
                  ? item.statusText
                  : `${item.statusText} ${item.progress}%`}
              </span>
            </div>
          ) : item.status === 'failed' ? (
            <span className="inline-flex items-start gap-1.5 font-medium text-destructive">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {item.error ?? 'The report could not be made.'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-ink">
              <CheckCircle2 aria-hidden="true" className="size-4 text-forest-700" />
              {item.statusText}
            </span>
          )}
        </div>
      </div>
      {item.download && item.documentHref ? (
        <div className="flex flex-col gap-2 sm:flex-row md:shrink-0">
          <PillButton size="md" onClick={item.download} className="max-sm:w-full">
            <Download aria-hidden="true" />
            Download PDF<span className="sr-only">: {item.label}</span>
          </PillButton>
          <PillButton asChild variant="light" size="md" className="max-sm:w-full">
            <OriginLink to={item.documentHref}>
              Open<span className="sr-only"> the {item.label} report</span>
            </OriginLink>
          </PillButton>
        </div>
      ) : null}
    </article>
  );
}

function GenerateDialog({ model }: { model: Ready }) {
  const { dialog } = model;
  return (
    <Dialog.Root open={dialog.open} onOpenChange={dialog.setOpen}>
      <Dialog.Trigger asChild>
        <PillButton size="md" className="max-sm:w-full">
          <FileStack aria-hidden="true" />
          Generate Semestral End Report
        </PillButton>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40 duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-3xl bg-white px-gutter pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] shadow-pool-lift duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none md:inset-x-auto md:top-1/2 md:left-1/2 md:bottom-auto md:w-[min(32rem,calc(100vw-4rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-3xl md:p-8">
          <div
            aria-hidden="true"
            className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-surface-deep md:hidden"
          />
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-h3 font-bold text-ink">
              Generate Semestral End Report
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="-mt-1.5 grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink transition-colors duration-300 hover:bg-surface focus-visible:bg-surface"
            >
              <X aria-hidden="true" className="size-6" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-body text-ink-muted">
            It includes every project whose event date falls in the semester. Missing files get a
            “Not submitted” page. You’ll be notified when it’s ready.
          </Dialog.Description>
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              dialog.submit();
            }}
            className="mt-6 flex flex-col gap-5"
          >
            <SelectField
              label="Semester"
              options={model.options}
              value={dialog.selected}
              onChange={(event) => dialog.select(event.target.value)}
            />
            {dialog.error ? (
              <p role="alert" className="text-body font-medium text-destructive">
                {dialog.error}
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
              <Dialog.Close asChild>
                <PillButton variant="light" size="md" className="max-sm:w-full">
                  Cancel
                </PillButton>
              </Dialog.Close>
              <PillButton
                type="submit"
                size="md"
                disabled={dialog.submitting || !dialog.selected}
                className="max-sm:w-full"
              >
                {dialog.submitting ? 'Starting…' : 'Generate'}
              </PillButton>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
