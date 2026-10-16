import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router';
import { Container } from '@/components/container';
import { DocumentCard, DocumentCardSkeleton } from '@/components/document-card';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import type { PaperworksDocuments, PaperworksState } from '../presenters/use-paperworks';
import { FilterFields, FilterSheet } from './paperworks-filters';

export type PaperworksViewProps = Exclude<PaperworksState, { status: 'not-found' }>;

/** Results: one card per row on phones, 2 columns from md, 3 from lg. */
const GRID = 'grid gap-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-6';

/**
 * /orgs/:slug/paperworks: an organization's document archive. Filters sit in a row above
 * the grid from md; on phones they open in a bottom sheet.
 */
export function PaperworksView(props: PaperworksViewProps) {
  return (
    <div className="bg-surface-sweep min-h-dvh">
      <title>
        {props.status === 'ready'
          ? `${props.org.acronym} Paperworks | Orghive`
          : 'Paperworks | Orghive'}
      </title>
      <Container as="main" className="pt-6 pb-section lg:pt-10">
        {props.status === 'ready' ? (
          <>
            <Link
              to={props.org.href}
              className="tap-area inline-flex items-center gap-2 text-body font-medium text-ink underline decoration-1 underline-offset-4 transition-colors duration-300 hover:decoration-leaf focus-visible:decoration-leaf"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              {props.org.acronym}
            </Link>
            <header className="mt-8 lg:mt-12">
              <h1 className="text-display font-bold text-ink">Paperworks</h1>
              <p className="mt-2 text-lead text-ink">{props.org.name}</p>
            </header>

            <div className="mt-8 hidden md:block">
              <FilterFields filters={props.filters} layout="row" />
              {props.filters.activeCount > 0 ? (
                <button
                  type="button"
                  onClick={props.filters.clear}
                  className="tap-area mt-3 cursor-pointer text-small font-medium text-ink underline decoration-1 underline-offset-4 hover:decoration-leaf focus-visible:decoration-leaf"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
            <div className="mt-6 md:hidden">
              <FilterSheet filters={props.filters} />
            </div>

            <section aria-label="Documents" className="mt-8">
              <Documents documents={props.documents} hasFilters={props.filters.activeCount > 0} />
            </section>
          </>
        ) : props.status === 'error' ? (
          <>
            <h1 className="text-display font-bold text-ink">Paperworks</h1>
            <SectionError
              className="mt-8"
              message="These Paperworks could not be loaded. Check your connection and try again."
              onRetry={props.retry}
            />
          </>
        ) : (
          <div aria-busy="true">
            <h1 className="sr-only">Loading Paperworks</h1>
            <Skeleton className="h-5 w-24" />
            <Skeleton className="mt-8 h-(--text-display) w-64 lg:mt-12" />
            <Skeleton className="mt-3 h-5 w-80 max-w-full" />
            <CardSkeletons />
          </div>
        )}
      </Container>
    </div>
  );
}

function CardSkeletons() {
  return (
    <ul aria-hidden="true" className={`mt-8 ${GRID}`}>
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i}>
          <DocumentCardSkeleton />
        </li>
      ))}
    </ul>
  );
}

function Documents({
  documents,
  hasFilters,
}: {
  documents: PaperworksDocuments;
  hasFilters: boolean;
}) {
  switch (documents.status) {
    case 'loading':
      return (
        <div aria-busy="true">
          <p className="sr-only">Loading documents</p>
          <CardSkeletons />
        </div>
      );
    case 'error':
      return (
        <SectionError
          message="The documents could not be loaded. Check your connection and try again."
          onRetry={documents.retry}
        />
      );
    case 'empty':
      return (
        <p role="status" className="max-w-prose text-body-lg text-ink">
          {hasFilters
            ? 'No documents match these filters. Clear a filter to see more.'
            : 'No Paperworks have been published here yet. Approved documents will appear here.'}
        </p>
      );
    case 'ready':
      return (
        <>
          <ul className={GRID}>
            {documents.items.map(({ id, ...card }) => (
              <li key={id}>
                <DocumentCard {...card} className="h-full" />
              </li>
            ))}
          </ul>
          {documents.hasMore ? (
            <div className="mt-10 flex justify-center">
              <PillButton
                variant="light"
                size="md"
                onClick={documents.loadMore}
                disabled={documents.isLoadingMore}
                aria-busy={documents.isLoadingMore || undefined}
              >
                {documents.isLoadingMore ? 'Loading…' : 'Load more'}
              </PillButton>
            </div>
          ) : null}
        </>
      );
  }
}
