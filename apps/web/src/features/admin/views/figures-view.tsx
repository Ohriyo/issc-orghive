import { useId } from 'react';
import { Dialog } from 'radix-ui';
import { SearchCheck } from 'lucide-react';
import { FLAG_REMARK_MAX_LENGTH } from '@orghive/shared';
import { FilterSelect } from '@/components/filter-bar';
import { TextAreaField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { FormAlert } from '@/features/auth/views/auth-layout';
import { OVERLAY, PANEL, SECONDARY } from '@/features/system/views/system-dialogs';
import { OriginLink } from '@/navigation/origin-link';
import { cn } from '@/lib/utils';
import type { AdminFiguresModel, FiguresRow } from '../presenters/use-admin-figures';

/**
 * /admin/financial-figures: the totals each organization reported with its Financial
 * Reports this semester, for the ISSC to check. Figures under review stay out of the
 * leaderboard's profit totals until cleared; points are not affected.
 */
export function FiguresView({ model }: { model: AdminFiguresModel }) {
  const id = useId();
  const { state } = model;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-prose">
          <h1 className="text-h2 font-bold text-ink">Financial figures</h1>
          <p className="mt-2 text-body text-ink">
            Totals reported with submitted Financial Reports. Put any under review to leave its
            profit out of the leaderboard until you clear it. The report file and its
            visibility are not affected.
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

      <div className="mt-8">
        {state.status === 'loading' ? (
          <div aria-busy="true" className="space-y-3">
            <p className="sr-only">Loading the figures</p>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 w-full rounded-2xl" />
            ))}
          </div>
        ) : state.status === 'error' ? (
          <SectionError
            message="The figures could not be loaded. Check your connection and try again."
            onRetry={state.retry}
          />
        ) : state.rows.length === 0 ? (
          <p className="rounded-2xl bg-white p-6 text-body text-ink ring-1 ring-border">
            No Financial Report has been submitted for {model.semester.label} yet.
          </p>
        ) : (
          <>
            <p className="mb-3 text-small text-ink-muted" aria-live="polite">
              {state.rows.length} {state.rows.length === 1 ? 'report' : 'reports'},{' '}
              {state.underReview} under review
            </p>
            <ul className="divide-y divide-border rounded-2xl bg-white ring-1 ring-border">
              {state.rows.map((row) => (
                <FiguresItem
                  key={row.projectId}
                  row={row}
                  onFlag={() => model.flag(row)}
                  onClear={() => model.clear(row)}
                  clearing={model.clearing === row.projectId}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      <FlagDialog dialog={model.dialog} />
    </>
  );
}

function FiguresItem({
  row,
  onFlag,
  onClear,
  clearing,
}: {
  row: FiguresRow;
  onFlag: () => void;
  onClear: () => void;
  clearing: boolean;
}) {
  return (
    <li className="grid gap-x-6 gap-y-3 p-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center md:p-5">
      <div className="min-w-0">
        <p className="text-small font-semibold text-ink-muted">
          {row.org}, event {row.eventDate}
        </p>
        <OriginLink
          to={row.projectHref}
          className="inline-flex min-h-11 items-center text-body-lg font-semibold break-words text-ink hover:underline focus-visible:underline"
        >
          {row.projectName}
        </OriginLink>
        {row.review ? (
          <p className="mt-2 flex items-start gap-2 text-small text-caution">
            <SearchCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 break-words">
              Under review since {row.review.since}: “{row.review.remark}”
            </span>
          </p>
        ) : null}
      </div>
      <dl className="grid grid-cols-3 gap-x-4 text-small md:min-w-[22rem]">
        <div>
          <dt className="text-ink-muted">Income</dt>
          <dd className="font-medium text-ink tabular-nums">{row.income}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Expenses</dt>
          <dd className="font-medium text-ink tabular-nums">{row.expenses}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Net</dt>
          <dd
            className={cn(
              'font-semibold tabular-nums',
              row.negative ? 'text-destructive' : 'text-ink',
            )}
          >
            {row.net}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-3 md:justify-end">
        {row.review ? (
          <>
            <PillButton variant="light" onClick={onFlag}>
              Edit remark
            </PillButton>
            <PillButton onClick={onClear} disabled={clearing}>
              {clearing ? 'Clearing…' : 'Clear review'}
            </PillButton>
          </>
        ) : (
          <PillButton variant="light" onClick={onFlag}>
            Put under review
          </PillButton>
        )}
      </div>
    </li>
  );
}

function FlagDialog({ dialog }: { dialog: AdminFiguresModel['dialog'] }) {
  return (
    <Dialog.Root open={dialog.open} onOpenChange={(open) => !open && dialog.close()}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY} />
        <Dialog.Content className={PANEL}>
          <Dialog.Title className="text-h3 font-bold text-ink">Put the figures under review</Dialog.Title>
          <Dialog.Description className="mt-2 text-body text-ink">
            {dialog.projectName}. Its profit leaves the leaderboard total until you clear the
            review; its points still count. The organization is told, with your remark, and can
            correct the figures.
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
            <TextAreaField
              label="What needs checking"
              hint="The organization sees this remark."
              value={dialog.remark}
              maxLength={FLAG_REMARK_MAX_LENGTH}
              onChange={(event) => dialog.setRemark(event.target.value)}
              disabled={dialog.saving}
            />
            <div className="mt-2 flex flex-wrap items-center justify-end gap-6">
              <Dialog.Close className={SECONDARY}>Cancel</Dialog.Close>
              <PillButton type="submit" disabled={dialog.saving}>
                {dialog.saving ? 'Saving…' : 'Put under review'}
              </PillButton>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
