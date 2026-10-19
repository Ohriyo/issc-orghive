import { Search } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import type { DataTableColumn } from '@/components/data-table-features';
import { SelectField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { TextField } from '@/components/text-field';
import { cn } from '@/lib/utils';
import type { SystemUsersModel, UserRow } from '../presenters/use-system-users';
import { ConfirmDialog, StepUpDialog } from './system-dialogs';
import { SystemLoading } from './system-layout';

const ROW_ACTION =
  'tap-area cursor-pointer rounded-sm text-small font-semibold whitespace-nowrap text-ink underline decoration-transparent decoration-1 underline-offset-4 transition-colors hover:decoration-ink focus-visible:decoration-ink disabled:cursor-default disabled:opacity-50';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'disabled', label: 'Deactivated' },
];

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'plain' | 'forest' | 'caution';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-small font-medium whitespace-nowrap',
        tone === 'plain' && 'bg-surface text-ink',
        tone === 'forest' && 'bg-forest-500/12 text-forest-900',
        tone === 'caution' && 'bg-caution-surface text-caution',
      )}
    >
      {children}
    </span>
  );
}

function Identity({ row }: { row: UserRow }) {
  return (
    <span className="flex min-w-0 flex-col whitespace-normal">
      <span className="font-medium text-ink">
        {row.name}
        {row.isSelf ? <span className="text-ink-muted"> (you)</span> : null}
      </span>
      <span className="text-small break-all text-ink-muted">{row.email}</span>
    </span>
  );
}

/** Role, and for super admins whether their authenticator is set up. */
function Access({ row }: { row: UserRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge tone={row.role === 'Super admin' ? 'forest' : 'plain'}>{row.role}</Badge>
      {row.mfa?.pending ? (
        <Badge tone="caution">{row.mfa.label}</Badge>
      ) : row.mfa ? (
        <span className="text-small whitespace-nowrap text-ink-muted">{row.mfa.label}</span>
      ) : null}
    </span>
  );
}

function Status({ row }: { row: UserRow }) {
  return <Badge tone={row.status === 'Active' ? 'plain' : 'caution'}>{row.status}</Badge>;
}

function Actions({ row, model }: { row: UserRow; model: SystemUsersModel }) {
  return (
    <span className="flex justify-end gap-x-6">
      {row.actions.map((action) => (
        <button
          key={action.kind}
          type="button"
          className={ROW_ACTION}
          disabled={model.pendingId === row.id}
          aria-label={`${action.label}: ${row.name}`}
          onClick={() => model.act(action.kind, row.id)}
        >
          {action.label}
        </button>
      ))}
    </span>
  );
}

function columns(model: SystemUsersModel): DataTableColumn<UserRow>[] {
  return [
    {
      id: 'user',
      header: 'User',
      cell: ({ row }) => (
        <span className="block max-w-80 min-w-48">
          <Identity row={row.original} />
        </span>
      ),
    },
    { id: 'access', header: 'Access', cell: ({ row }) => <Access row={row.original} /> },
    { id: 'status', header: 'Status', cell: ({ row }) => <Status row={row.original} /> },
    {
      id: 'organization',
      header: 'Organization',
      cell: ({ row }) => row.original.organization ?? '—',
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => <Actions row={row.original} model={model} />,
    },
  ];
}

/** Phones: one card per account, actions included, instead of a sideways-scrolling table. */
function UserCards({
  rows,
  model,
  label,
}: {
  rows: UserRow[];
  model: SystemUsersModel;
  label: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl bg-white px-5 py-6 text-body text-ink-muted ring-1 ring-border">
        No accounts match. Try another name or clear the filters.
      </p>
    );
  }
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-3 rounded-xl bg-white p-4 ring-1 ring-border">
          <Identity row={row} />
          <span className="flex flex-wrap items-center gap-1.5">
            <Access row={row} />
            <Status row={row} />
            <span className="text-small text-ink-muted">
              {row.organization ?? 'No organization'}
            </span>
          </span>
          {row.actions.length > 0 ? (
            <span className="flex justify-start border-t border-border pt-3">
              <Actions row={row} model={model} />
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** /system/users and /system/super-admins. */
export function UsersView({
  model,
  superAdmins,
}: {
  model: SystemUsersModel;
  superAdmins: boolean;
}) {
  const { filters, list } = model;
  return (
    <div className="flex flex-col gap-6">
      <form
        role="search"
        className="flex flex-col gap-4 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          filters.search();
        }}
      >
        <TextField
          label="Name or email"
          type="search"
          className="min-w-0 sm:flex-1"
          value={filters.query}
          onChange={(event) => filters.setQuery(event.target.value)}
        />
        <SelectField
          label="Status"
          className="sm:w-48"
          placeholder="Any"
          options={STATUS_OPTIONS}
          value={filters.status}
          onChange={(event) => filters.setStatus(event.target.value as typeof filters.status)}
        />
        <PillButton type="submit" className="self-start sm:self-auto">
          <Search aria-hidden="true" />
          Search
        </PillButton>
      </form>

      {list.status === 'loading' ? (
        <SystemLoading label="Loading accounts" />
      ) : list.status === 'error' ? (
        <SectionError message="The accounts could not be loaded." onRetry={list.retry} />
      ) : (
        <>
          <div className="md:hidden">
            <UserCards
              rows={list.rows}
              model={model}
              label={superAdmins ? 'Super admins' : 'User accounts'}
            />
          </div>
          <div className="hidden md:block">
            <DataTable
              columns={columns(model)}
              data={list.rows}
              getRowId={(row) => row.id}
              caption={superAdmins ? 'Super admins' : 'User accounts'}
              empty={
                <p className="py-6 text-center text-body text-ink-muted">
                  No accounts match. Try another name or clear the filters.
                </p>
              }
              cellClassName={{ actions: 'text-right' }}
            />
          </div>
          {list.hasMore ? (
            <PillButton
              variant="light"
              className="self-center"
              onClick={list.loadMore}
              disabled={list.isLoadingMore}
            >
              {list.isLoadingMore ? 'Loading…' : 'Show more'}
            </PillButton>
          ) : null}
        </>
      )}

      <ConfirmDialog confirming={model.confirming} onCancel={model.cancelConfirm} />
      <StepUpDialog {...model.stepUp} />
    </div>
  );
}
