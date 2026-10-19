import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import type { DataTableColumn } from '@/components/data-table-features';
import { OrgLogo } from '@/components/org-logo';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { cn } from '@/lib/utils';
import type { AdminOrganizationsState, HierarchyRow } from '../presenters/use-admin-organizations';
import { OrganizationSheet } from './organization-sheet';

type Ready = Extract<AdminOrganizationsState, { status: 'ready' }>;

const ROW_ACTION =
  'tap-area min-w-9 cursor-pointer rounded-sm text-center text-small font-semibold text-ink underline decoration-transparent decoration-1 underline-offset-4 transition-colors hover:decoration-ink focus-visible:decoration-ink disabled:cursor-default disabled:opacity-50';
const MOVE_BUTTON =
  'grid size-11 cursor-pointer place-items-center rounded-full text-ink transition-colors hover:bg-surface focus-visible:bg-surface disabled:cursor-default disabled:text-ink-muted/40 disabled:hover:bg-transparent';

/**
 * The guide that ties a college's CSC and SBOs to it: a forest line down the left of the
 * group, with a short branch to each row. It ends at the group's last row.
 */
function TreeGuide({ last }: { last: boolean }) {
  return (
    <span aria-hidden="true">
      <span
        className={cn('absolute left-6 w-px bg-forest-500/35', last ? 'top-0 h-1/2' : 'inset-y-0')}
      />
      <span className="absolute top-1/2 left-6 h-px w-3 bg-forest-500/35" />
    </span>
  );
}

function NameCell({ row }: { row: HierarchyRow }) {
  if (row.kind === 'college') {
    return (
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="font-bold text-ink">{row.label}</span>
        <span className="truncate text-ink-muted">{row.name}</span>
      </span>
    );
  }
  return (
    <span className={cn('flex min-w-0 items-center gap-3', row.depth === 1 && 'pl-7')}>
      {row.depth === 1 ? <TreeGuide last={row.lastInGroup} /> : null}
      <OrgLogo
        name={row.name}
        src={row.logoUrl ?? undefined}
        alt=""
        fallbackText={row.label}
        className={cn('size-8 shrink-0 rounded-full', row.logoUrl ? 'bg-white' : 'bg-forest-band')}
      />
      <span className="min-w-0">
        <span className="block font-semibold text-ink">{row.label}</span>
        <span className="block max-w-[22rem] truncate text-caption text-ink-muted">{row.name}</span>
      </span>
    </span>
  );
}

function OrderCell({ row }: { row: HierarchyRow }) {
  if (!row.move) return null;
  const { up, down, position, of } = row.move;
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        className={MOVE_BUTTON}
        aria-label={`Move ${row.label} up`}
        disabled={!up}
        onClick={up ?? undefined}
      >
        <ChevronUp aria-hidden="true" className="size-5" />
      </button>
      <button
        type="button"
        className={MOVE_BUTTON}
        aria-label={`Move ${row.label} down`}
        disabled={!down}
        onClick={down ?? undefined}
      >
        <ChevronDown aria-hidden="true" className="size-5" />
      </button>
      <span className="ml-1 text-caption text-ink-muted">
        {position} of {of}
      </span>
    </span>
  );
}

function StatusCell({ row }: { row: HierarchyRow }) {
  if (row.active === null) return null;
  return row.active ? (
    <span className="text-ink-muted">Active</span>
  ) : (
    <span className="rounded-full bg-caution-surface px-2.5 py-1 text-caption font-semibold text-caution">
      Inactive
    </span>
  );
}

function columnsFor(state: Ready): DataTableColumn<HierarchyRow>[] {
  return [
    {
      id: 'name',
      header: 'Organization',
      cell: ({ row }) => <NameCell row={row.original} />,
    },
    {
      id: 'order',
      header: 'Carousel order',
      cell: ({ row }) => <OrderCell row={row.original} />,
    },
    { id: 'documents', header: 'Documents', cell: ({ row }) => row.original.documentCount },
    {
      id: 'account',
      header: 'Account',
      cell: ({ row }) =>
        row.original.hasAccount === null ? null : row.original.hasAccount ? 'Active' : 'None',
    },
    { id: 'status', header: 'Status', cell: ({ row }) => <StatusCell row={row.original} /> },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => <RowActions row={row.original} state={state} />,
    },
  ];
}

function RowActions({ row, state }: { row: HierarchyRow; state: Ready }) {
  return (
    <span className="flex items-center justify-end gap-5">
      {row.adds.map((type) => (
        <button
          key={type}
          type="button"
          className={ROW_ACTION}
          aria-label={`Add ${type} to ${row.label}`}
          onClick={() => state.newOrganization(row.slug, type)}
        >
          Add {type}
        </button>
      ))}
      <button
        type="button"
        className={ROW_ACTION}
        aria-label={`Edit ${row.label}`}
        onClick={() =>
          row.kind === 'college' ? state.openCollege(row.slug) : state.openOrganization(row.slug)
        }
      >
        Edit
      </button>
      {row.active !== null && row.kind !== 'issc' ? (
        <button
          type="button"
          className={ROW_ACTION}
          disabled={state.pending}
          aria-label={`${row.active ? 'Deactivate' : 'Activate'} ${row.label}`}
          onClick={() => state.setActive(row.slug, !row.active)}
        >
          {row.active ? 'Deactivate' : 'Activate'}
        </button>
      ) : null}
    </span>
  );
}

/**
 * Below lg the table becomes a list: each organization with its status, order and
 * actions on its own lines, so nothing needs a sideways scroll on a phone or tablet.
 */
function HierarchyList({ rows, state }: { rows: HierarchyRow[]; state: Ready }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl bg-white ring-1 ring-border lg:hidden">
      {rows.map((row) => (
        <li key={row.id} className={cn('px-4 py-3', row.kind === 'college' && 'bg-surface/60')}>
          <div className="relative">
            <NameCell row={row} />
          </div>
          <div
            className={cn(
              'mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1',
              row.depth === 1 && 'pl-7',
            )}
          >
            <span className="flex items-center gap-3 text-small">
              <StatusCell row={row} />
              {row.documentCount !== null ? (
                <span className="text-ink-muted">
                  {row.documentCount} documents,{' '}
                  {row.hasAccount ? 'account active' : 'no account yet'}
                </span>
              ) : null}
            </span>
            <OrderCell row={row} />
          </div>
          <div className={cn('mt-1 flex justify-start', row.depth === 1 && 'pl-7')}>
            <RowActions row={row} state={state} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * /admin/organizations: the hierarchy as one table, in the order the public carousels show
 * it. Colleges head their group; their CSC and SBOs hang under them.
 */
export function OrganizationsView({ state }: { state: AdminOrganizationsState }) {
  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h2 font-bold text-ink">Organizations</h1>
          <p className="mt-1 max-w-prose text-body text-ink-muted">
            The order here is the order of the public carousels. Inactive organizations are hidden
            from browsing and cannot upload, but their documents stay available.
          </p>
        </div>
        {state.status === 'ready' ? (
          <PillButton size="md" onClick={() => state.openCollege(null)}>
            <Plus aria-hidden="true" />
            Add college
          </PillButton>
        ) : null}
      </header>

      <section aria-label="Colleges and organizations" className="mt-6">
        {state.status === 'loading' ? (
          <div aria-busy="true" className="space-y-2">
            <p className="sr-only">Loading organizations</p>
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : state.status === 'error' ? (
          <SectionError
            message="The organizations could not be loaded. Check your connection and try again."
            onRetry={state.retry}
          />
        ) : (
          <>
            <HierarchyList rows={state.rows} state={state} />
            <div className="hidden lg:block">
              <DataTable
                columns={columnsFor(state)}
                data={state.rows}
                getRowId={(row) => row.id}
                caption="Colleges and organizations, in carousel order"
                empty="No colleges yet. Add the first one."
                rowClassName={(row) =>
                  row.kind === 'college' ? 'bg-surface/60 hover:bg-surface' : undefined
                }
                cellClassName={{
                  name: 'relative min-w-64',
                  documents: 'text-right',
                  members: 'text-right',
                  actions: 'text-right',
                }}
              />
            </div>
            <OrganizationSheet state={state} />
          </>
        )}
      </section>
    </>
  );
}
