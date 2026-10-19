import { Download, ShieldCheck, Snowflake } from 'lucide-react';
import { Container } from '@/components/container';
import { DataTable } from '@/components/data-table';
import type { DataTableColumn } from '@/components/data-table-features';
import { SelectField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { DeadlineBadge } from '@/features/projects/views/project-badges';
import { cn } from '@/lib/utils';
import { OriginLink } from '@/navigation/origin-link';
import type { ComplianceRowView, OverviewSort } from '../presenters/compliance-format';
import type { ComplianceOverviewModel } from '../presenters/use-compliance-overview';

type Ready = Extract<ComplianceOverviewModel, { status: 'ready' }>;

/**
 * Links in the table sit on their own line at a full 44px height: tap-area alone leaves
 * small text under the minimum (CLAUDE.md), and links mid-sentence cannot grow.
 */
const TEXT_LINK =
  'inline-flex min-h-11 min-w-11 items-center rounded-sm text-ink underline decoration-ink/30 decoration-1 underline-offset-4 break-words transition-colors duration-300 hover:decoration-ink focus-visible:decoration-ink';
const MUTED_DASH = <span className="text-ink-muted">None</span>;

function OrganizationCell({ row }: { row: ComplianceRowView }) {
  return (
    <span className="block min-w-0">
      <OriginLink to={row.href} className={cn(TEXT_LINK, 'font-semibold')}>
        {row.acronym}
      </OriginLink>
      <span className="mt-0.5 block max-w-[18rem] truncate text-caption text-ink-muted">
        {row.kind} · {row.name}
      </span>
    </span>
  );
}

function NextDeadlineCell({ row }: { row: ComplianceRowView }) {
  const next = row.nextDeadline;
  if (!next) return MUTED_DASH;
  return (
    <span className="flex flex-col items-start gap-1">
      <DeadlineBadge deadline={next.label} />
      <span className="text-caption text-ink-muted">{next.task}</span>
      <OriginLink to={next.href} className={cn(TEXT_LINK, '-mt-2 text-small')}>
        {next.projectName}
      </OriginLink>
    </span>
  );
}

function OverdueCell({ row }: { row: ComplianceRowView }) {
  if (!row.overdue.text) return MUTED_DASH;
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="font-semibold text-destructive">{row.overdue.text}</span>
      {row.overdue.oldest ? (
        <>
          <span className="text-caption text-ink-muted">Oldest: {row.overdue.oldest.task}</span>
          <OriginLink to={row.overdue.oldest.href} className={cn(TEXT_LINK, '-mt-2 text-small')}>
            {row.overdue.oldest.projectName}
          </OriginLink>
        </>
      ) : null}
    </span>
  );
}

function BlockedCell({ row }: { row: ComplianceRowView }) {
  if (row.blocked.length === 0) return MUTED_DASH;
  return (
    <ul className="flex flex-col">
      {row.blocked.map((p) => (
        <li key={p.id}>
          <OriginLink to={p.href} className={cn(TEXT_LINK, 'text-destructive')}>
            {p.name}
          </OriginLink>
        </li>
      ))}
    </ul>
  );
}

function FrozenCell({ row }: { row: ComplianceRowView }) {
  if (!row.frozen || !row.frozenSince) return <span className="text-ink-muted">Not frozen</span>;
  // A short chip that never wraps, and the date under it: a long pill breaks into a blob
  // in a narrow table column.
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-caution-surface px-2.5 py-0.5 text-caption font-semibold whitespace-nowrap text-caution">
        <Snowflake aria-hidden="true" className="size-3.5 shrink-0" />
        Frozen
      </span>
      <span className="text-caption text-ink-muted">since {row.frozenSince}</span>
    </span>
  );
}

const COLUMNS: DataTableColumn<ComplianceRowView>[] = [
  {
    id: 'organization',
    header: 'Organization',
    cell: ({ row }) => <OrganizationCell row={row.original} />,
  },
  { id: 'active', header: 'Active projects', cell: ({ row }) => row.original.activeProjects },
  {
    id: 'next',
    header: 'Next deadline',
    cell: ({ row }) => <NextDeadlineCell row={row.original} />,
  },
  { id: 'overdue', header: 'Overdue tasks', cell: ({ row }) => <OverdueCell row={row.original} /> },
  {
    id: 'blocked',
    header: 'Blocked projects',
    cell: ({ row }) => <BlockedCell row={row.original} />,
  },
  { id: 'frozen', header: 'Freeze', cell: ({ row }) => <FrozenCell row={row.original} /> },
  { id: 'appeals', header: 'Open appeals', cell: ({ row }) => row.original.openAppeals },
];

/** Below lg each organization is a card: every column as a labelled line, no sideways scroll. */
function OverviewCards({ rows }: { rows: ComplianceRowView[] }) {
  return (
    <ul className="flex flex-col gap-4 lg:hidden">
      {rows.map((row) => (
        <li key={row.slug} className="rounded-2xl bg-white p-5 shadow-pool ring-1 ring-ink/10">
          <OrganizationCell row={row} />
          <dl className="mt-4 grid gap-x-6 gap-y-4 text-small sm:grid-cols-2">
            <CardLine label="Active projects">{row.activeProjects}</CardLine>
            <CardLine label="Open appeals">{row.openAppeals}</CardLine>
            <CardLine label="Next deadline">
              <NextDeadlineCell row={row} />
            </CardLine>
            <CardLine label="Overdue tasks">
              <OverdueCell row={row} />
            </CardLine>
            <CardLine label="Blocked projects">
              <BlockedCell row={row} />
            </CardLine>
            <CardLine label="Freeze">
              <FrozenCell row={row} />
            </CardLine>
          </dl>
        </li>
      ))}
    </ul>
  );
}

function CardLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption font-medium text-ink-muted">{label}</dt>
      <dd className="mt-1 text-ink">{children}</dd>
    </div>
  );
}

function Totals({ totals }: { totals: Ready['totals'] }) {
  const items = [
    { label: 'Organizations', value: totals.organizations, alert: false },
    { label: 'With overdue tasks', value: totals.withOverdue, alert: totals.withOverdue > 0 },
    { label: 'Blocked projects', value: totals.blockedProjects, alert: totals.blockedProjects > 0 },
    { label: 'Frozen', value: totals.frozen, alert: totals.frozen > 0 },
    { label: 'Open appeals', value: totals.openAppeals, alert: false },
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-2xl bg-white p-5 shadow-pool ring-1 ring-ink/10 sm:grid-cols-3 lg:grid-cols-5 md:p-6">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-small text-ink-muted">{item.label}</dt>
          <dd
            className={cn(
              'mt-1 text-h2 leading-none font-bold tabular-nums',
              item.alert ? 'text-destructive' : 'text-ink',
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * /dashboard/compliance: each organization a council oversees, with its projects this
 * semester, deadlines, blocks, freeze and open appeals. Read-only: nothing here decides.
 */
export function ComplianceOverviewView({ model }: { model: ComplianceOverviewModel }) {
  return (
    <div className="bg-surface-sweep min-h-page">
      <title>Compliance overview | Orghive</title>
      <Container as="main" className="pt-4 pb-section lg:pt-6">
        <div className="mt-6">
          <h1 className="text-h1 font-bold text-ink">Compliance overview</h1>
          <p className="mt-2 max-w-prose text-body text-ink-muted">
            {model.status === 'ready'
              ? `${model.scope}. Projects count in the semester of their event date; freezes and appeals show whatever the semester.`
              : 'Projects, deadlines, freezes and appeals of the organizations your council oversees.'}
          </p>
        </div>

        {model.status === 'forbidden' ? (
          <div className="mt-8 flex flex-col items-start gap-3 rounded-2xl bg-white p-6 ring-1 ring-ink/10">
            <ShieldCheck aria-hidden="true" className="size-8 text-ink-muted" />
            <p className="text-body-lg font-semibold text-ink">For the CSCs and the ISSC</p>
            <p className="max-w-prose text-body text-ink-muted">
              The compliance overview is for the Collegiate Student Council accounts and the ISSC.
              Your own organization&apos;s projects are on your dashboard.
            </p>
            <PillButton asChild variant="light" size="md" className="mt-2">
              <OriginLink to="/dashboard">Go to the dashboard</OriginLink>
            </PillButton>
          </div>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap items-end gap-4">
              <SelectField
                label="Semester"
                className="w-full sm:w-64"
                options={model.semester.options}
                value={model.semester.value}
                onChange={(event) => model.semester.set(event.target.value)}
              />
              <SelectField
                label="Sort by"
                className="w-full sm:w-48"
                options={model.sort.options}
                value={model.sort.value}
                onChange={(event) => model.sort.set(event.target.value as OverviewSort)}
              />
              <PillButton
                variant="light"
                size="md"
                className="max-sm:w-full sm:ml-auto"
                disabled={model.status !== 'ready' || model.rows.length === 0}
                onClick={model.status === 'ready' ? model.exportCsv : undefined}
              >
                <Download aria-hidden="true" />
                Export CSV
              </PillButton>
            </div>

            <section aria-label="Organizations" className="mt-6 flex flex-col gap-6">
              {model.status === 'loading' ? (
                <div aria-busy="true" className="flex flex-col gap-4">
                  <span className="sr-only">Loading the compliance overview</span>
                  <Skeleton className="h-24 w-full rounded-2xl" />
                  {Array.from({ length: 4 }, (_, i) => (
                    <Skeleton key={i} className="h-20 w-full rounded-xl" />
                  ))}
                </div>
              ) : model.status === 'error' ? (
                <SectionError
                  message="The compliance overview could not be loaded. Check your connection and try again."
                  onRetry={model.retry}
                />
              ) : model.rows.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-2xl bg-white/70 p-8 text-center ring-1 ring-ink/10">
                  <ShieldCheck aria-hidden="true" className="size-8 text-ink-muted" />
                  <p className="text-body-lg font-semibold text-ink">No organizations to show</p>
                  <p className="max-w-prose text-body text-ink-muted">
                    Active organizations under your council appear here once they exist.
                  </p>
                </div>
              ) : (
                <>
                  <Totals totals={model.totals} />
                  <OverviewCards rows={model.rows} />
                  <div className="hidden lg:block">
                    <DataTable
                      columns={COLUMNS}
                      data={model.rows}
                      getRowId={(row) => row.slug}
                      caption={`Organizations, sorted by ${model.sort.value === 'overdue' ? 'most overdue' : 'name'}`}
                      empty="No organizations to show."
                      // Project names wrap (table cells default to nowrap), so all seven
                      // columns fit from lg instead of the last three scrolling off.
                      cellClassName={{
                        organization: 'min-w-44 align-top',
                        active: 'w-px text-right align-top whitespace-normal tabular-nums',
                        next: 'min-w-60 align-top whitespace-normal',
                        overdue: 'min-w-40 align-top whitespace-normal',
                        blocked: 'min-w-36 align-top whitespace-normal',
                        frozen: 'align-top whitespace-normal',
                        appeals: 'w-px text-right align-top whitespace-normal tabular-nums',
                      }}
                    />
                  </div>
                </>
              )}
            </section>
          </>
        )}
      </Container>
    </div>
  );
}
