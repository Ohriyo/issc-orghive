import { useId } from 'react';
import { Search } from 'lucide-react';
import { Container } from '@/components/container';
import { DocumentCard, DocumentCardSkeleton } from '@/components/document-card';
import { FilterFields, FilterSheet, type FilterSelectSpec } from '@/components/filter-bar';
import { HighlightedText } from '@/components/highlighted-text';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { OriginLink } from '@/navigation/origin-link';
import type {
  SearchFilterModel,
  SearchPageResults,
  SearchPageState,
  SearchSelect,
} from '../presenters/use-search-page';

const PLACEHOLDER = 'Titles, tags, descriptions and text inside PDFs';

/** Results: one card per row on phones, 2 columns from md, 3 from lg (as in Paperworks). */
const GRID = 'grid gap-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-6';

function selectsOf({ options }: SearchFilterModel): FilterSelectSpec<SearchSelect>[] {
  return [
    { name: 'college', label: 'College', all: 'All colleges', options: options.colleges },
    { name: 'org', label: 'Organization', all: 'All organizations', options: options.orgs },
    { name: 'type', label: 'Type', all: 'All types', options: options.types },
    { name: 'year', label: 'Academic year', all: 'All years', options: options.years },
  ];
}

/**
 * /search: one large search box, filters in a row from md (a bottom sheet on phones), and
 * the matches as document cards with the passage that matched.
 */
export function SearchPageView({ filters, results }: SearchPageState) {
  const id = useId();
  const selects = selectsOf(filters);
  return (
    <div className="bg-surface-sweep min-h-page">
      <title>{results.query ? `“${results.query}”: Search | Orghive` : 'Search | Orghive'}</title>
      <Container as="main" className="pt-4 pb-section lg:pt-6">
        <h1 className="text-display font-bold text-ink">Search</h1>
        <p className="mt-2 max-w-prose text-lead text-ink">
          Every organization&rsquo;s Paperworks you can see, in one place.
        </p>

        <form role="search" className="mt-8" onSubmit={(event) => event.preventDefault()}>
          <label htmlFor={`${id}-q`} className="sr-only">
            Search Paperworks
          </label>
          <div className="flex h-14 min-w-0 items-center gap-3 rounded-full border border-input bg-white px-5 shadow-pool focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-ink">
            <Search aria-hidden="true" className="size-5 shrink-0 text-ink-muted" />
            <input
              id={`${id}-q`}
              type="search"
              value={filters.searchInput}
              onChange={(event) => filters.setSearchInput(event.target.value)}
              placeholder={PLACEHOLDER}
              enterKeyHint="search"
              className="min-w-0 flex-1 bg-transparent text-body-lg text-ink outline-none placeholder:text-ink-muted"
            />
          </div>
        </form>

        <div className="mt-6 hidden md:block">
          <FilterFields
            filters={filters}
            selects={selects}
            placeholder={PLACEHOLDER}
            search={false}
            layout="row"
          />
          {filters.activeCount > 0 ? (
            <button
              type="button"
              onClick={filters.clear}
              className="tap-area mt-3 cursor-pointer text-small font-medium text-ink underline decoration-1 underline-offset-4 hover:decoration-leaf focus-visible:decoration-leaf"
            >
              Clear filters
            </button>
          ) : null}
        </div>
        <div className="mt-6 md:hidden">
          <FilterSheet
            filters={filters}
            selects={selects}
            placeholder={PLACEHOLDER}
            search={false}
          />
        </div>

        <section aria-label="Results" className="mt-8">
          <Results results={results} hasFilters={filters.activeCount > 0} />
        </section>
      </Container>
    </div>
  );
}

function CardSkeletons() {
  return (
    <ul aria-hidden="true" className={GRID}>
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i}>
          <DocumentCardSkeleton />
        </li>
      ))}
    </ul>
  );
}

function Results({ results, hasFilters }: { results: SearchPageResults; hasFilters: boolean }) {
  switch (results.status) {
    case 'idle':
      return (
        <p className="max-w-prose text-body-lg text-ink">
          Type at least two characters to search proposals, reports, resolutions and every other
          document you can see.
        </p>
      );
    case 'loading':
      return (
        <div aria-busy="true">
          <p className="sr-only">Searching</p>
          <CardSkeletons />
        </div>
      );
    case 'error':
      return (
        <SectionError
          message="Search is not available right now. Check your connection and try again."
          onRetry={results.retry}
        />
      );
    case 'empty':
      return (
        <p role="status" className="max-w-prose text-body-lg text-ink">
          {hasFilters
            ? `Nothing matches “${results.query}” with these filters. Clear a filter to see more.`
            : `No Paperworks match “${results.query}”. Try another word or a shorter phrase.`}
        </p>
      );
    case 'ready':
      return (
        <>
          <p role="status" className="mb-5 text-small text-ink-muted">
            Best matches for &ldquo;{results.query}&rdquo;
          </p>
          {results.handbook ? <HandbookMatches handbook={results.handbook} /> : null}
          {results.items.length === 0 ? (
            <p className="max-w-prose text-body-lg text-ink">
              No Paperworks match &ldquo;{results.query}&rdquo;.
            </p>
          ) : null}
          <ul className={GRID}>
            {results.items.map(({ id, ...card }) => (
              <li key={id}>
                <DocumentCard {...card} className="h-full" />
              </li>
            ))}
          </ul>
          {results.hasMore ? (
            <div className="mt-10 flex justify-center">
              <PillButton
                variant="light"
                size="md"
                onClick={results.loadMore}
                disabled={results.isLoadingMore}
                aria-busy={results.isLoadingMore || undefined}
              >
                {results.isLoadingMore ? 'Loading…' : 'Load more'}
              </PillButton>
            </div>
          ) : null}
        </>
      );
  }
}

/** The current Student Handbook's matching pages, each opening the handbook at that page. */
function HandbookMatches({ handbook }: { handbook: NonNullable<SearchPageResults['handbook']> }) {
  return (
    <section aria-labelledby="handbook-matches-heading" className="mb-10">
      <h2 id="handbook-matches-heading" className="text-h3 font-bold text-ink">
        In the Student Handbook
        <span className="ml-2 text-body font-normal text-ink-muted">{handbook.yearLabel}</span>
      </h2>
      <ol className="mt-4 grid gap-3 md:grid-cols-3">
        {handbook.matches.map((match) => (
          <li key={match.page}>
            <OriginLink
              to={match.href}
              className="group flex h-full flex-col gap-2 rounded-2xl bg-white p-4 shadow-pool ring-1 ring-ink/10 transition-shadow duration-300 hover:shadow-pool-lift focus-visible:shadow-pool-lift"
            >
              <span className="text-small font-semibold text-ink underline decoration-transparent decoration-1 underline-offset-4 transition-colors duration-300 group-hover:decoration-leaf group-focus-visible:decoration-leaf">
                Page {match.page}
              </span>
              <HighlightedText parts={match.snippet} className="line-clamp-3 text-small text-ink" />
            </OriginLink>
          </li>
        ))}
      </ol>
    </section>
  );
}
