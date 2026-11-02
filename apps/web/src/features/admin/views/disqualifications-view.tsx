import { useId } from 'react';
import { Dialog } from 'radix-ui';
import { Ban } from 'lucide-react';
import { ActingAsField } from '@/components/acting-as-field';
import { FilterSelect } from '@/components/filter-bar';
import { TextAreaField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { FormAlert } from '@/features/auth/views/auth-layout';
import { OVERLAY, PANEL, SECONDARY } from '@/features/system/views/system-dialogs';
import type {
  AdminDisqualificationsModel,
  DisqualificationRow,
} from '../presenters/use-admin-disqualifications';

/**
 * /admin/disqualifications: who the ISSC disqualified from a semester's leaderboard, and why.
 * The reason is told to the organization, and never shown on the public board.
 */
export function DisqualificationsView({ model }: { model: AdminDisqualificationsModel }) {
  const id = useId();
  const { state } = model;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-prose">
          <h1 className="text-h2 font-bold text-ink">Disqualifications</h1>
          <p className="mt-2 text-body text-ink">
            A disqualified organization is left off the semester&apos;s leaderboard, and everyone
            below it moves up. Its files and projects are not affected. The organization is told
            your reason; the public board never shows it.
          </p>
        </div>
        <div className="w-full sm:w-64">
          <FilterSelect
            id={`${id}-semester`}
            label="Semester"
            value={model.semester.value}
            options={model.semester.options}
            onChange={model.setSemester}
          />
        </div>
      </div>

      <div className="mt-6">
        {state.status === 'loading' ? (
          <div aria-busy="true" className="space-y-3">
            <p className="sr-only">Loading the disqualifications</p>
            <Skeleton className="h-24 w-full" />
          </div>
        ) : state.status === 'error' ? (
          <SectionError
            message="The disqualifications could not be loaded. Check your connection and try again."
            onRetry={state.retry}
          />
        ) : (
          <>
            {state.final ? (
              <p className="mb-4 rounded-2xl bg-white p-4 text-body text-ink ring-1 ring-border">
                The standings of {model.semester.label} are final, so nothing here can change.
              </p>
            ) : (
              <div className="mb-4">
                <PillButton onClick={model.disqualify}>Disqualify an organization</PillButton>
              </div>
            )}
            {state.rows.length === 0 ? (
              <p className="rounded-2xl bg-white p-6 text-body text-ink ring-1 ring-border">
                No organization was disqualified from {model.semester.label}.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-2xl bg-white ring-1 ring-border">
                {state.rows.map((row) => (
                  <DisqualificationItem
                    key={row.id}
                    row={row}
                    final={state.final}
                    onLift={() => model.lift(row)}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <PenaltyDialog dialog={model.dialog} semester={model.semester.label} />
    </>
  );
}

function DisqualificationItem({
  row,
  final,
  onLift,
}: {
  row: DisqualificationRow;
  final: boolean;
  onLift: () => void;
}) {
  return (
    <li className="grid gap-x-6 gap-y-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-5">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-body-lg font-semibold text-ink">
          {row.lifted ? null : (
            <Ban aria-hidden="true" className="size-4 shrink-0 text-destructive" />
          )}
          {row.organization}
        </h2>
        <p className="mt-1 text-body break-words text-ink">“{row.reason}”</p>
        <p className="mt-1 text-small text-ink-muted">{row.by}</p>
        {row.lifted ? (
          <p className="mt-1 text-small break-words text-ink-muted">{row.lifted}</p>
        ) : null}
      </div>
      {row.lifted || final ? null : (
        <div className="flex md:justify-end">
          <PillButton
            variant="light"
            onClick={onLift}
            aria-label={`Lift the disqualification of ${row.organization}`}
          >
            Lift
          </PillButton>
        </div>
      )}
    </li>
  );
}

function PenaltyDialog({
  dialog,
  semester,
}: {
  dialog: AdminDisqualificationsModel['dialog'];
  semester: string;
}) {
  const id = useId();
  const disqualifying = dialog.mode === 'disqualify';
  return (
    <Dialog.Root open={dialog.mode !== null} onOpenChange={(open) => !open && dialog.close()}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY} />
        <Dialog.Content className={PANEL}>
          <Dialog.Title className="text-h3 font-bold text-ink">
            {disqualifying ? 'Disqualify an organization' : 'Lift the disqualification'}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-body text-ink">
            {disqualifying
              ? `From the leaderboard of ${semester}. The organization is told your reason.`
              : `${dialog.organization} counts on the leaderboard of ${semester} again. The organization is told your reason.`}
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
            {disqualifying ? (
              <FilterSelect
                id={`${id}-organization`}
                label="Organization"
                all="Choose an organization"
                value={dialog.organizationId}
                options={dialog.organizations}
                onChange={dialog.setOrganizationId}
              />
            ) : null}
            <TextAreaField
              label="Reason"
              hint="The organization sees this."
              value={dialog.reason}
              maxLength={500}
              onChange={(event) => dialog.setReason(event.target.value)}
              disabled={dialog.saving}
            />
            <ActingAsField
              orgAcronym="ISSC"
              savedWith="the decision"
              value={dialog.actingAs.value}
              error={dialog.actingAs.error}
              onChange={(event) => dialog.actingAs.onChange(event.target.value)}
              disabled={dialog.saving}
            />
            <div className="mt-2 flex flex-wrap items-center justify-end gap-6">
              <Dialog.Close className={SECONDARY}>Cancel</Dialog.Close>
              <PillButton type="submit" disabled={dialog.saving}>
                {dialog.saving ? 'Saving…' : disqualifying ? 'Disqualify' : 'Lift'}
              </PillButton>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
