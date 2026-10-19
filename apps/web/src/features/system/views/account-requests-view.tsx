import { Dialog } from 'radix-ui';
import { Link } from 'react-router';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { TextField } from '@/components/text-field';
import { FormAlert } from '@/features/auth/views/auth-layout';
import { OriginLink } from '@/navigation/origin-link';
import { cn } from '@/lib/utils';
import type {
  AccountRequestsModel,
  RequestFilter,
  RequestRow,
} from '../presenters/use-account-requests';
import { OVERLAY, PANEL, SECONDARY } from './system-dialogs';
import { SystemLoading } from './system-layout';
import { Badge } from './users-view';

const FILTERS: { key: RequestFilter; label: string }[] = [
  { key: 'requested', label: 'Open' },
  { key: 'all', label: 'All' },
];
const ROW_ACTION =
  'tap-area cursor-pointer rounded-sm text-body font-semibold whitespace-nowrap text-ink underline decoration-transparent decoration-1 underline-offset-4 transition-colors hover:decoration-ink focus-visible:decoration-ink';

function Request({ row, model }: { row: RequestRow; model: AccountRequestsModel }) {
  return (
    <li className="flex flex-col gap-3 rounded-xl bg-white p-4 ring-1 ring-border md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-body-lg font-semibold break-words text-ink">{row.organization}</h2>
          <p className="text-small text-ink-muted">{row.where}</p>
        </div>
        <Badge
          tone={
            row.status === 'Requested' ? 'forest' : row.status === 'Declined' ? 'caution' : 'plain'
          }
        >
          {row.status}
        </Badge>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-body sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-small text-ink-muted">Account email</dt>
          <dd className="break-all text-ink">{row.accountEmail}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-small text-ink-muted">Officer in charge</dt>
          <dd className="break-words text-ink">{row.officer}</dd>
        </div>
        <div>
          <dt className="text-small text-ink-muted">Requested</dt>
          <dd className="text-ink">
            {row.requested} by {row.requestedBy}
          </dd>
        </div>
        {row.note ? (
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-small text-ink-muted">Note</dt>
            <dd className="break-words text-ink">{row.note}</dd>
          </div>
        ) : null}
        {row.declineReason ? (
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-small text-ink-muted">Declined because</dt>
            <dd className="break-words text-ink">{row.declineReason}</dd>
          </div>
        ) : null}
      </dl>
      {row.canCreate || row.canDecline || row.accountHref ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border pt-3">
          {row.canCreate ? (
            <PillButton asChild>
              <Link to={row.createHref} aria-label={`Create account: ${row.organization}`}>
                Create account
              </Link>
            </PillButton>
          ) : null}
          {row.canDecline ? (
            <button
              type="button"
              className={ROW_ACTION}
              aria-label={`Decline: ${row.organization}`}
              onClick={() => model.askDecline(row)}
            >
              Decline
            </button>
          ) : null}
          {row.accountHref ? (
            <OriginLink to={row.accountHref} className={ROW_ACTION}>
              Open the account
            </OriginLink>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function DeclineDialog({ dialog }: { dialog: AccountRequestsModel['declineDialog'] }) {
  return (
    <Dialog.Root open={dialog.open} onOpenChange={(open) => !open && dialog.onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY} />
        <Dialog.Content className={PANEL}>
          <Dialog.Title className="text-h3 font-bold text-ink">Decline this request?</Dialog.Title>
          <Dialog.Description className="mt-2 text-body text-ink">
            {dialog.organization}. The ISSC account is told the reason and can ask again.
          </Dialog.Description>
          <form
            noValidate
            onSubmit={(event) => void dialog.onSubmit(event)}
            className="mt-5 flex flex-col gap-5"
          >
            <FormAlert message={dialog.formError} />
            <TextField
              label="Reason"
              autoFocus
              error={dialog.errors.reason?.message}
              {...dialog.register('reason')}
            />
            <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-3">
              <Dialog.Close className={SECONDARY}>Cancel</Dialog.Close>
              <PillButton type="submit" disabled={dialog.isSubmitting}>
                {dialog.isSubmitting ? 'Declining…' : 'Decline request'}
              </PillButton>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** /system/account-requests */
export function AccountRequestsView({ model }: { model: AccountRequestsModel }) {
  const { list } = model;
  return (
    <div className="flex flex-col gap-6">
      <div
        role="group"
        aria-label="Show"
        className="inline-flex self-start rounded-full bg-white p-1 ring-1 ring-border"
      >
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={model.filter === f.key}
            onClick={() => model.setFilter(f.key)}
            className={cn(
              'min-h-11 cursor-pointer rounded-full px-5 text-body font-medium whitespace-nowrap text-ink transition-colors duration-300',
              model.filter === f.key
                ? 'bg-ink text-white'
                : 'hover:bg-surface focus-visible:bg-surface',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      {list.status === 'loading' ? (
        <SystemLoading label="Loading account requests" />
      ) : list.status === 'error' ? (
        <SectionError message="The account requests could not be loaded." onRetry={list.retry} />
      ) : list.rows.length === 0 ? (
        <p className="rounded-xl bg-white px-5 py-6 text-body text-ink-muted ring-1 ring-border">
          {model.filter === 'requested'
            ? 'No open requests.'
            : 'The ISSC has not requested any account yet.'}
        </p>
      ) : (
        <ul aria-label="Account requests" className="flex flex-col gap-4">
          {list.rows.map((row) => (
            <Request key={row.id} row={row} model={model} />
          ))}
        </ul>
      )}
      <DeclineDialog dialog={model.declineDialog} />
    </div>
  );
}
