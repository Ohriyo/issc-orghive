import { Trash2 } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import type { DataTableColumn } from '@/components/data-table-features';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import type { TestDataModel } from '../presenters/use-test-data';
import { ConfirmDialog, StepUpDialog } from './system-dialogs';
import { SystemLoading } from './system-layout';

type Ready = Extract<TestDataModel, { status: 'ready' }>;
type Row = Ready['rows'][number];

const COLUMNS: DataTableColumn<Row>[] = [
  { id: 'organization', header: 'Organization', cell: ({ row }) => row.original.organization },
  { id: 'type', header: 'Type', cell: ({ row }) => row.original.type },
  { id: 'status', header: 'Status', cell: ({ row }) => row.original.status },
  { id: 'created', header: 'Uploaded', cell: ({ row }) => row.original.created },
];

/** /system/test-data */
export function TestDataView({ model }: { model: TestDataModel }) {
  if (model.status === 'loading') return <SystemLoading label="Loading test data" />;
  if (model.status === 'error') {
    return <SectionError message="The test data could not be loaded." onRetry={model.retry} />;
  }
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-prose text-body text-ink">
        When &ldquo;Members only&rdquo; was retired, those files became private and were flagged as
        test data. Titles stay hidden: they are private files.
      </p>
      {model.total === 0 ? (
        <p className="rounded-xl bg-white px-5 py-6 text-body text-ink-muted ring-1 ring-border">
          No test data left.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p aria-live="polite" className="text-body font-medium text-ink">
              {model.total === 1 ? '1 file' : `${model.total} files`}
              {model.shown < model.total ? ` (the newest ${model.shown} listed)` : ''}
            </p>
            <PillButton onClick={model.askDelete} disabled={model.deleting}>
              <Trash2 aria-hidden="true" />
              {model.deleting ? 'Deleting…' : 'Delete test data'}
            </PillButton>
          </div>
          <ul aria-label="Files flagged as test data" className="flex flex-col gap-3 md:hidden">
            {model.rows.map((row) => (
              <li key={row.id} className="rounded-xl bg-white p-4 ring-1 ring-border">
                <span className="block font-medium text-ink">{row.organization}</span>
                <span className="text-small text-ink-muted">
                  {[row.type, row.status, `uploaded ${row.created}`].join(' · ')}
                </span>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <DataTable
              columns={COLUMNS}
              data={model.rows}
              getRowId={(row) => row.id}
              caption="Files flagged as test data"
              empty={null}
            />
          </div>
        </>
      )}
      <ConfirmDialog confirming={model.confirming} onCancel={model.cancelConfirm} />
      <StepUpDialog {...model.stepUp} />
    </div>
  );
}
