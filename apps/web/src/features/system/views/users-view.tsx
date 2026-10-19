import { ChevronLeft, ChevronRight, FileUp, Search, UserPlus } from 'lucide-react';
import { Link } from 'react-router';
import { DataTable } from '@/components/data-table';
import type { DataTableColumn } from '@/components/data-table-features';
import { SelectField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { TextField } from '@/components/text-field';
import { OriginLink } from '@/navigation/origin-link';
import { cn } from '@/lib/utils';
import {
  LAST_LOGIN_OPTIONS,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  type AccountStanding,
  type SystemUsersModel,
  type UserRow,
} from '../presenters/use-system-users';
import { ConfirmDialog, StepUpDialog } from './system-dialogs';
import { SystemLoading } from './system-layout';

const ROW_ACTION =
  'tap-area cursor-pointer rounded-sm text-small font-semibold whitespace-nowrap text-ink underline decoration-transparent decoration-1 underline-offset-4 transition-colors hover:decoration-ink focus-visible:decoration-ink disabled:cursor-default disabled:opacity-50';
const NAME_LINK =
  'tap-area rounded-sm font-medium text-ink underline decoration-transparent underline-offset-4 transition-colors hover:decoration-ink focus-visible:decoration-ink';

export function Badge({
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

export function StandingBadge({ standing }: { standing: AccountStanding }) {
  return <Badge tone={standing === 'Active' ? 'plain' : 'caution'}>{standing}</Badge>;
}

function Identity({ row, linked }: { row: UserRow; linked: boolean }) {
  return (
    <span className="flex min-w-0 flex-col whitespace-normal">
      {linked ? (
        <OriginLink to={row.href} className={NAME_LINK}>
          {row.name}
        </OriginLink>
      ) : (
        <span className="font-medium text-ink">
          {row.name}
          {row.isSelf ? <span className="text-ink-muted"> (you)</span> : null}
        </span>
      )}
      <span className="text-small break-all text-ink-muted">{row.email}</span>
    </span>
  );
}

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

function Organization({ row }: { row: UserRow }) {
  return (
    <span className="flex min-w-0 flex-col whitespace-normal">
      <span className="text-ink">{row.organization ?? '—'}</span>
      {row.officer ? <span className="text-small text-ink-muted">{row.officer}</span> : null}
    </span>
  );
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

function columns(model: SystemUsersModel, superAdmins: boolean): DataTableColumn<UserRow>[] {
  const cols: DataTableColumn<UserRow>[] = [
    {
      id: 'user',
      header: 'Account',
      cell: ({ row }) => (
        <span className="block max-w-80 min-w-48">
          <Identity row={row.original} linked={!superAdmins} />
        </span>
      ),
    },
    superAdmins
      ? { id: 'access', header: 'Access', cell: ({ row }) => <Access row={row.original} /> }
      : {
          id: 'organization',
          header: 'Organization',
          cell: ({ row }) => (
            <span className="block max-w-72 min-w-40">
              <Organization row={row.original} />
            </span>
          ),
        },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <StandingBadge standing={row.original.standing} />,
    },
    { id: 'lastLogin', header: 'Last sign-in', cell: ({ row }) => row.original.lastLogin },
  ];
  if (superAdmins) {
    cols.push({
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => <Actions row={row.original} model={model} />,
    });
  }
  return cols;
}

const EMPTY = 'No accounts match. Try another name or clear the filters.';

/** Phones: one card per account instead of a sideways-scrolling table. */
function UserCards({
  rows,
  model,
  label,
  superAdmins,
}: {
  rows: UserRow[];
  model: SystemUsersModel;
  label: string;
  superAdmins: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl bg-white px-5 py-6 text-body text-ink-muted ring-1 ring-border">
        {EMPTY}
      </p>
    );
  }
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-3 rounded-xl bg-white p-4 ring-1 ring-border">
          <Identity row={row} linked={!superAdmins} />
          <span className="flex flex-wrap items-center gap-1.5">
            {superAdmins ? <Access row={row} /> : null}
            <StandingBadge standing={row.standing} />
          </span>
          {superAdmins ? null : <Organization row={row} />}
          <span className="text-small text-ink-muted">Last sign-in: {row.lastLogin}</span>
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

/** Numbered pages: the current one and its neighbours, with the first and last. */
function pagesAround(page: number, count: number): (number | 'gap')[] {
  const wanted = new Set([1, count, page - 1, page, page + 1].filter((p) => p >= 1 && p <= count));
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1]! > 1) out.push('gap');
    out.push(p);
  });
  return out;
}

const PAGE_BUTTON =
  'grid size-11 cursor-pointer place-items-center rounded-full text-body font-medium text-ink transition-colors hover:bg-white focus-visible:bg-white disabled:cursor-default disabled:opacity-40 aria-[current=page]:bg-forest-band aria-[current=page]:text-white';

export function Pager({
  page,
  pageCount,
  goTo,
  label,
}: {
  page: number;
  pageCount: number;
  goTo: (page: number) => void;
  label: string;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-center gap-1">
      <button
        type="button"
        className={PAGE_BUTTON}
        disabled={page === 1}
        onClick={() => goTo(page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft aria-hidden="true" className="size-5" />
      </button>
      {pagesAround(page, pageCount).map((p, i) =>
        p === 'gap' ? (
          <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-ink-muted">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            className={PAGE_BUTTON}
            aria-current={p === page ? 'page' : undefined}
            aria-label={`Page ${p}`}
            onClick={() => goTo(p)}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        className={PAGE_BUTTON}
        disabled={page === pageCount}
        onClick={() => goTo(page + 1)}
        aria-label="Next page"
      >
        <ChevronRight aria-hidden="true" className="size-5" />
      </button>
    </nav>
  );
}

/** "Bulk create", for the Users page header. */
export function BulkCreateButton() {
  return (
    <PillButton asChild variant="light">
      <Link to="/system/accounts/bulk">
        <FileUp aria-hidden="true" />
        Bulk create
      </Link>
    </PillButton>
  );
}

/** "Create account", for the Users page header. */
export function CreateAccountButton() {
  return (
    <PillButton asChild>
      <Link to="/system/users/new">
        <UserPlus aria-hidden="true" />
        Create account
      </Link>
    </PillButton>
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
  const label = superAdmins ? 'Super admins' : 'Organization accounts';
  return (
    <div className="flex flex-col gap-6">
      <form
        role="search"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] lg:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          filters.search();
        }}
      >
        <TextField
          label={superAdmins ? 'Name or email' : 'Name, email or organization'}
          type="search"
          className="min-w-0 sm:col-span-2 lg:col-span-1"
          value={filters.query}
          onChange={(event) => filters.setQuery(event.target.value)}
        />
        {superAdmins ? null : (
          <SelectField
            label="Type"
            placeholder="Any"
            options={TYPE_OPTIONS}
            value={filters.type}
            onChange={(event) => filters.setType(event.target.value as typeof filters.type)}
          />
        )}
        <SelectField
          label="Status"
          placeholder="Any"
          options={STATUS_OPTIONS}
          value={filters.status}
          onChange={(event) => filters.setStatus(event.target.value as typeof filters.status)}
        />
        <SelectField
          label="Last sign-in"
          placeholder="Any time"
          options={LAST_LOGIN_OPTIONS}
          value={filters.lastLogin}
          onChange={(event) => filters.setLastLogin(event.target.value as typeof filters.lastLogin)}
        />
        <PillButton type="submit" className="self-start sm:self-end">
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
          <p aria-live="polite" className="text-small text-ink-muted">
            {list.total === 1 ? '1 account' : `${list.total} accounts`}
            {list.pageCount > 1 ? `, page ${list.page} of ${list.pageCount}` : ''}
          </p>
          <div className={cn('md:hidden', list.isFetching && 'opacity-60')}>
            <UserCards rows={list.rows} model={model} label={label} superAdmins={superAdmins} />
          </div>
          <div className={cn('hidden md:block', list.isFetching && 'opacity-60')}>
            <DataTable
              columns={columns(model, superAdmins)}
              data={list.rows}
              getRowId={(row) => row.id}
              caption={label}
              empty={<p className="py-6 text-center text-body text-ink-muted">{EMPTY}</p>}
              cellClassName={{ actions: 'text-right' }}
            />
          </div>
          <Pager
            page={list.page}
            pageCount={list.pageCount}
            goTo={list.goTo}
            label={`${label} pages`}
          />
        </>
      )}

      <ConfirmDialog confirming={model.confirming} onCancel={model.cancelConfirm} />
      <StepUpDialog {...model.stepUp} />
    </div>
  );
}
