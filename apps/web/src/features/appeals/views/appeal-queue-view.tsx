import { Inbox } from 'lucide-react';
import { REJECT_REMARKS_MIN } from '@orghive/shared';
import { Container } from '@/components/container';
import { TextAreaField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { TextField } from '@/components/text-field';
import { cn } from '@/lib/utils';
import { OriginLink } from '@/navigation/origin-link';
import type { AppealQueueModel, QueueItem, QueueTab } from '../presenters/use-appeal-queue';
import { AppealDetails, AppealStatusChip } from './appeal-parts';

const TABS: { key: QueueTab; label: string }[] = [
  { key: 'pending', label: 'Waiting for you' },
  { key: 'decided', label: 'Decided by you' },
];

/** /dashboard/appeals: appeals to decide, one card each with approve and reject. */
export function AppealQueueView({ model }: { model: AppealQueueModel }) {
  return (
    <div className="bg-surface-sweep min-h-page">
      <title>Appeals | Orghive</title>
      <Container as="main" className="max-w-4xl pt-4 pb-section lg:pt-6">
        <header className="mt-6">
          <h1 className="text-h1 font-bold text-ink">Appeals</h1>
          <p className="mt-2 max-w-prose text-body text-ink-muted">
            Organizations appeal when a project is blocked or they are frozen. Approving sets a new
            due date; rejecting keeps the block, and they see your remarks.
          </p>
        </header>
        <div
          role="group"
          aria-label="Show"
          className="mt-6 inline-flex max-w-full rounded-full bg-white p-1 shadow-pool ring-1 ring-ink/10"
        >
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"

              aria-pressed={model.tab === tab.key}
              onClick={() => model.setTab(tab.key)}
              className={cn(
                'min-h-11 cursor-pointer rounded-full px-4 text-body font-medium whitespace-nowrap text-ink transition-colors duration-300 motion-reduce:transition-none sm:px-5',
                model.tab === tab.key
                  ? 'bg-ink text-white'
                  : 'hover:bg-surface focus-visible:bg-surface',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="mt-6">
          {model.status === 'loading' ? (
            <div aria-busy="true" className="flex flex-col gap-4">
              <span className="sr-only">Loading the appeals</span>
              <Skeleton className="h-56 w-full rounded-2xl" />
              <Skeleton className="h-56 w-full rounded-2xl" />
            </div>
          ) : model.status === 'error' ? (
            <SectionError
              message="The appeals could not be loaded. Check your connection and try again."
              onRetry={model.retry}
            />
          ) : model.items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-white/70 p-8 text-center ring-1 ring-ink/10">
              <Inbox aria-hidden="true" className="size-8 text-ink-muted" />
              <p className="text-body-lg font-semibold text-ink">
                {model.tab === 'pending' ? 'Nothing waiting for your decision' : 'No decisions yet'}
              </p>
              <p className="max-w-prose text-body text-ink-muted">
                {model.tab === 'pending'
                  ? 'Appeals from the organizations you decide for appear here.'
                  : 'Appeals you approve or reject are listed here.'}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-5">
              {model.items.map((item) => (
                <li key={item.id}>
                  <AppealCard item={item} minDueDate={model.minDueDate} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </Container>
    </div>
  );
}

function AppealCard({ item, minDueDate }: { item: QueueItem; minDueDate: string }) {
  return (
    <article
      aria-labelledby={`appeal-${item.id}`}
      className="flex flex-col gap-4 rounded-2xl bg-white p-4 shadow-pool ring-1 ring-ink/10 md:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-small font-semibold text-forest-700">
            {item.org.acronym} · {item.typeLabel}
          </p>
          <h2 id={`appeal-${item.id}`} className="mt-1 text-h3 font-bold break-words text-ink">
            {item.project.name}
          </h2>
          <p className="text-small text-ink-muted">
            {item.org.name} · Event {item.project.eventDate}
          </p>
        </div>
        <AppealStatusChip status={item.status} label={item.statusLabel} />
      </div>
      <AppealDetails appeal={item} onOpenAttachment={item.openAttachment} />
      {item.canDecide ? <Decision item={item} minDueDate={minDueDate} /> : null}
      <OriginLink
        to={item.project.href}
        className="tap-area self-start text-small font-medium text-ink underline decoration-1 underline-offset-4 hover:decoration-leaf focus-visible:decoration-leaf"
      >
        Open the project
      </OriginLink>
    </article>
  );
}

function Decision({ item, minDueDate }: { item: QueueItem; minDueDate: string }) {
  const { draft } = item;
  if (draft.mode === 'idle') {
    return (
      <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:gap-3">
        <PillButton size="md" onClick={() => item.choose('approve')} className="max-sm:w-full">
          Approve…
        </PillButton>
        <PillButton
          size="md"
          variant="light"
          onClick={() => item.choose('reject')}
          className="max-sm:w-full"
        >
          Reject…
        </PillButton>
      </div>
    );
  }
  const approving = draft.mode === 'approve';
  return (
    <form
      noValidate
      aria-label={approving ? 'Approve the appeal' : 'Reject the appeal'}
      onSubmit={(event) => {
        event.preventDefault();
        item.confirm();
      }}
      className="flex flex-col gap-4 border-t border-border pt-4"
    >
      {approving ? (
        <TextField
          label="New due date"
          type="date"
          min={minDueDate}
          value={draft.newDueDate}
          hint={`Due at 11:59 PM Manila time that day. ${item.org.acronym} is unblocked until then.`}
          error={draft.errors.newDueDate}
          onChange={(event) => item.edit({ newDueDate: event.target.value })}
          className="sm:max-w-xs"
        />
      ) : null}
      <TextAreaField
        label={approving ? 'Remarks (optional)' : 'Remarks'}
        hint={
          approving
            ? undefined
            : `Tell ${item.org.acronym} why, so they can appeal again. At least ${REJECT_REMARKS_MIN} characters.`
        }
        value={draft.remarks}
        error={draft.errors.remarks}
        onChange={(event) => item.edit({ remarks: event.target.value })}
      />
      {draft.errors.form ? (
        <p role="alert" className="text-body font-medium text-destructive">
          {draft.errors.form}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
        <PillButton
          size="md"
          variant="light"
          onClick={() => item.choose('idle')}
          disabled={draft.saving}
          className="max-sm:w-full"
        >
          Cancel
        </PillButton>
        <PillButton type="submit" size="md" disabled={draft.saving} className="max-sm:w-full">
          {draft.saving ? 'Saving…' : approving ? 'Approve appeal' : 'Reject appeal'}
        </PillButton>
      </div>
    </form>
  );
}
