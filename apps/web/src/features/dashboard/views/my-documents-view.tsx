import { useState } from 'react';
import { Archive, ArchiveRestore, Search, Upload } from 'lucide-react';
import { OriginLink } from '@/navigation/origin-link';
import { Container } from '@/components/container';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { StatusBadge } from '@/components/status-badge';
import { VISIBILITY_LABEL } from '@/components/visibility';
import { VisibilitySelect } from '@/components/visibility-select';
import { cn } from '@/lib/utils';
import type { MyDocumentRow, MyDocumentsModel } from '../presenters/use-my-documents';
import { EditDocumentDialog } from './edit-document-dialog';
import { OrgSwitcher } from './org-switcher';

export interface MyDocumentsViewProps {
  model: MyDocumentsModel;
}

type Ready = Extract<MyDocumentsModel, { status: 'ready' }>;

const dateFormat = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' });

/** /dashboard/documents: every document of one organization the user may see, by state. */
export function MyDocumentsView({ model }: MyDocumentsViewProps) {
  return (
    <div className="bg-surface-sweep min-h-page">
      <title>
        {model.status === 'ready'
          ? `${model.org.acronym} documents | Orghive`
          : 'My documents | Orghive'}
      </title>
      <Container as="main" className="pt-4 pb-section lg:pt-6">
        {model.status === 'loading' ? (
          <div aria-busy="true" aria-label="Loading documents" className="mt-8">
            <Skeleton className="h-12 w-64" />
            <Skeleton className="mt-8 h-11 w-full rounded-full" />
            <Skeleton className="mt-6 h-24 w-full rounded-2xl" />
          </div>
        ) : model.status === 'error' ? (
          <>
            <h1 className="mt-8 text-h1 font-bold text-ink">My documents</h1>
            <SectionError
              className="mt-6"
              message="Your documents could not be loaded. Check your connection and try again."
              onRetry={model.retry}
            />
          </>
        ) : model.status === 'no-organization' ? (
          <>
            <h1 className="mt-8 text-h1 font-bold text-ink">My documents</h1>
            <p className="mt-4 max-w-prose text-body-lg text-ink">
              You’re not in an organization yet, so there are no documents to manage here.
            </p>
          </>
        ) : (
          <ReadyView model={model} />
        )}
      </Container>
    </div>
  );
}

function ReadyView({ model }: { model: Ready }) {
  return (
    <>
      {model.organizations.length > 1 ? (
        <OrgSwitcher
          className="mt-6"
          organizations={model.organizations}
          selectedId={model.org.id}
          onSelect={model.selectOrganization}
        />
      ) : null}
      <header className="mt-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-8">
        <div className="min-w-0">
          <h1 className="text-h1 font-bold text-ink">{model.org.acronym} documents</h1>
          <p className="mt-1 max-w-prose text-lead text-ink">
            Every document of {model.org.name} you can see, including files still being scanned.
          </p>
        </div>
        {model.canManage ? (
          <PillButton asChild size="md" className="self-start md:self-end">
            <OriginLink to={`/orgs/${model.org.slug}/paperworks/upload`}>
              <Upload aria-hidden="true" />
              Upload document
            </OriginLink>
          </PillButton>
        ) : null}
      </header>

      {/* Scrolls sideways inside itself on phones; the page never does. */}
      <nav aria-label="Status" className="mt-7 -mx-1 overflow-x-auto px-1 py-1">
        <ul className="flex w-max gap-2 pb-1">
          {model.tabs.map((t) => {
            const current = t.tab === model.tab;
            return (
              <li key={t.tab}>
                <OriginLink
                  to={t.href}
                  replace
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-body font-semibold whitespace-nowrap ring-1 transition-colors duration-300',
                    current
                      ? 'bg-forest-band text-white ring-transparent'
                      : 'bg-white text-ink ring-ink/10 hover:bg-pill-light focus-visible:bg-pill-light',
                  )}
                >
                  {t.label}
                  <span
                    className={cn(
                      'rounded-full px-2 text-small tabular-nums',
                      current ? 'bg-white/20' : 'bg-surface',
                    )}
                  >
                    {t.count}
                  </span>
                </OriginLink>
              </li>
            );
          })}
        </ul>
      </nav>

      {model.visibilityFilter ? (
        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-ink">
          Showing only: {model.visibilityFilter.label}
          <OriginLink
            to={model.visibilityFilter.clearHref}
            replace
            className="tap-area font-semibold underline decoration-1 underline-offset-4 hover:decoration-leaf focus-visible:decoration-leaf"
          >
            Show every visibility
          </OriginLink>
        </p>
      ) : null}

      <div role="search" className="mt-6 max-w-xl">
        <label htmlFor="my-documents-search" className="text-body font-medium text-ink">
          Search by title
        </label>
        <div className="mt-2 flex min-h-12 items-center gap-2 rounded-full bg-white px-4 ring-1 ring-input focus-within:ring-2 focus-within:ring-ink">
          <Search aria-hidden="true" className="size-5 shrink-0 text-ink-muted" />
          <input
            id="my-documents-search"
            type="search"
            value={model.searchInput}
            onChange={(event) => model.setSearchInput(event.target.value)}
            placeholder="e.g. accomplishment report"
            className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-muted"
          />
        </div>
      </div>

      <section aria-label="Documents" aria-live="polite" className="mt-8">
        <DocumentList model={model} />
      </section>
    </>
  );
}

function DocumentList({ model }: { model: Ready }) {
  const list = model.list;
  if (list.status === 'loading') {
    return (
      <div aria-busy="true" className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    );
  }
  if (list.status === 'error') {
    return (
      <SectionError
        message="These documents could not be loaded. Check your connection and try again."
        onRetry={list.retry}
      />
    );
  }
  if (list.rows.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-2xl bg-white/70 p-6 ring-1 ring-ink/10">
        <p className="text-body-lg text-ink">
          {model.query
            ? `No documents match “${model.query}” here.`
            : model.tab === 'all'
              ? 'No documents yet.'
              : `No documents in “${model.tabs.find((t) => t.tab === model.tab)!.label}”.`}
        </p>
        {model.query ? (
          <PillButton variant="light" size="md" onClick={() => model.setSearchInput('')}>
            Clear search
          </PillButton>
        ) : null}
      </div>
    );
  }
  return (
    <>
      <ul className="flex flex-col gap-3">
        {list.rows.map((row) => (
          <DocumentRow key={row.doc.id} row={row} model={model} />
        ))}
      </ul>
      {list.hasMore ? (
        <div className="mt-8 flex justify-center">
          <PillButton variant="light" size="md" onClick={list.loadMore} disabled={list.loadingMore}>
            {list.loadingMore ? 'Loading…' : 'Show more'}
          </PillButton>
        </div>
      ) : null}
    </>
  );
}

function DocumentRow({ row, model }: { row: MyDocumentRow; model: Ready }) {
  const [error, setError] = useState<string>();
  const { doc } = row;
  const busy = model.actions.pendingId === doc.id;
  return (
    <li className="flex flex-col gap-4 rounded-2xl bg-white p-4 shadow-pool ring-1 ring-ink/10 md:flex-row md:items-center md:p-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={doc.status} />
          <span className="text-small text-ink-muted">{doc.type.name}</span>
          {row.canChangeVisibility ? null : (
            <span className="text-small text-ink-muted">· {VISIBILITY_LABEL[doc.visibility]}</span>
          )}
        </div>
        <h2 className="mt-2 text-body-lg leading-snug font-semibold break-words text-ink">
          <OriginLink to={row.href} className="tap-area hover:underline focus-visible:underline">
            {doc.title}
          </OriginLink>
        </h2>
        <p className="mt-1 text-small text-ink-muted">
          {doc.academicYear}. Updated{' '}
          <time dateTime={doc.updatedAt}>{dateFormat.format(new Date(doc.updatedAt))}</time>
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-small font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      {row.canChangeVisibility ? (
        <VisibilitySelect
          className="md:w-56"
          value={doc.visibility}
          documentTitle={doc.title}
          disabled={busy}
          onChange={(visibility) =>
            void model.actions.setVisibility(doc.id, visibility).then(setError)
          }
        />
      ) : null}
      {row.canEdit || row.canArchive || row.canRestore ? (
        <div className="flex flex-wrap gap-2 md:justify-end">
          {row.canEdit ? (
            <EditDocumentDialog
              doc={doc}
              types={model.types}
              years={model.yearsFor(doc)}
              semesters={model.semesters}
              disabled={busy}
              onSave={(values) => model.actions.save(doc, values)}
            />
          ) : null}
          {row.canArchive ? (
            <PillButton
              variant="light"
              size="md"
              disabled={busy}
              onClick={() => void model.actions.archive(doc.id).then(setError)}
            >
              <Archive aria-hidden="true" />
              Archive<span className="sr-only">: {doc.title}</span>
            </PillButton>
          ) : null}
          {row.canRestore ? (
            <PillButton
              variant="light"
              size="md"
              disabled={busy}
              onClick={() => void model.actions.restore(doc.id).then(setError)}
            >
              <ArchiveRestore aria-hidden="true" />
              Restore<span className="sr-only">: {doc.title}</span>
            </PillButton>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
