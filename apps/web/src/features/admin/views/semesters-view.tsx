import { Dialog } from 'radix-ui';
import { ActingAsField } from '@/components/acting-as-field';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { TextField } from '@/components/text-field';
import { FormAlert } from '@/features/auth/views/auth-layout';
import { OVERLAY, PANEL, SECONDARY } from '@/features/system/views/system-dialogs';
import type { AdminSemestersModel, SemesterRow } from '../presenters/use-admin-semesters';

/**
 * /admin/semesters: the ISSC account sets each semester's first and last day. A project belongs
 * to the semester of its event date, and standings turn final after the last day.
 */
export function SemestersView({ model }: { model: AdminSemestersModel }) {
  const { state } = model;
  return (
    <>
      <div className="max-w-prose">
        <h1 className="text-h2 font-bold text-ink">Semesters</h1>
        <p className="mt-2 text-body text-ink">
          Set each semester&apos;s first and last day from the university calendar. A project counts
          in the semester of its event date, and an event in a break counts for the semester after
          it.
          {state.status === 'ready'
            ? ` Standings stay provisional for ${state.finalAfterDays} days after the last day, then they are final and the semester’s dates can no longer change.`
            : null}
        </p>
      </div>

      <p aria-live="polite" className="mt-4 text-small font-medium text-ink empty:hidden">
        {model.saved}
      </p>

      <div className="mt-6">
        {state.status === 'loading' ? (
          <div aria-busy="true" className="space-y-3">
            <p className="sr-only">Loading the semesters</p>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : state.status === 'error' ? (
          <SectionError
            message="The semesters could not be loaded. Check your connection and try again."
            onRetry={state.retry}
          />
        ) : (
          <ul className="divide-y divide-border rounded-2xl bg-white ring-1 ring-border">
            {state.rows.map((row) => (
              <SemesterItem key={row.id} row={row} onEdit={() => model.edit(row)} />
            ))}
          </ul>
        )}
      </div>

      <SemesterDialog dialog={model.dialog} />
    </>
  );
}

function SemesterItem({ row, onEdit }: { row: SemesterRow; onEdit: () => void }) {
  return (
    <li className="grid gap-x-6 gap-y-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-5">
      <div className="min-w-0">
        <h2 className="text-body-lg font-semibold text-ink">{row.label}</h2>
        <p className="mt-1 text-body text-ink">{row.dates}</p>
        <p className="mt-1 text-small text-ink-muted">
          {row.source}. {row.standing}.
        </p>
      </div>
      {row.locked ? null : (
        <div className="flex md:justify-end">
          <PillButton variant="light" onClick={onEdit} aria-label={`Set the dates of ${row.label}`}>
            Set dates
          </PillButton>
        </div>
      )}
    </li>
  );
}

function SemesterDialog({ dialog }: { dialog: AdminSemestersModel['dialog'] }) {
  return (
    <Dialog.Root open={dialog.open} onOpenChange={(open) => !open && dialog.close()}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY} />
        <Dialog.Content className={PANEL}>
          <Dialog.Title className="text-h3 font-bold text-ink">
            Set the semester&apos;s dates
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-body text-ink">
            {dialog.label}. Projects move between semesters to follow the new dates, and the
            leaderboards are recomputed. Recorded in the audit log.
          </Dialog.Description>
          <form
            noValidate
            className="mt-6 flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              dialog.submit();
            }}
          >
            <FormAlert message={dialog.error ?? undefined} />
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                label="First day"
                type="date"
                value={dialog.start}
                onChange={(event) => dialog.setStart(event.target.value)}
                disabled={dialog.saving}
              />
              <TextField
                label="Last day"
                type="date"
                value={dialog.end}
                onChange={(event) => dialog.setEnd(event.target.value)}
                disabled={dialog.saving}
              />
            </div>
            <ActingAsField
              orgAcronym="ISSC"
              savedWith="the dates"
              value={dialog.actingAs.value}
              error={dialog.actingAs.error}
              onChange={(event) => dialog.actingAs.onChange(event.target.value)}
              disabled={dialog.saving}
            />
            <div className="mt-2 flex flex-wrap items-center justify-end gap-6">
              <Dialog.Close className={SECONDARY}>Cancel</Dialog.Close>
              <PillButton type="submit" disabled={dialog.saving}>
                {dialog.saving ? 'Saving…' : 'Save dates'}
              </PillButton>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
