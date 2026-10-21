import { useId } from 'react';
import { Search, X } from 'lucide-react';
import { HANDBOOK_SEARCH_MIN } from '@orghive/shared';
import { HighlightedText } from '@/components/highlighted-text';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { cn } from '@/lib/utils';
import type { HandbookContents, HandbookSearchModel } from '../presenters/use-handbook';

export interface HandbookGuideProps {
  query: string;
  setQuery: (q: string) => void;
  search: HandbookSearchModel;
  contents: HandbookContents;
  currentPage: number;
  /** Open a page (and close the sheet on phones). */
  onOpen: (page: number) => void;
}

const ROW =
  'flex min-h-11 w-full cursor-pointer items-baseline gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-300 hover:bg-white focus-visible:bg-white aria-[current=true]:bg-white aria-[current=true]:font-semibold';

/**
 * Finding your way in the handbook: search its text (matches jump to their page) and, when
 * not searching, its contents: the PDF's bookmarks, else page thumbnails.
 */
export function HandbookGuide({
  query,
  setQuery,
  search,
  contents,
  currentPage,
  onOpen,
}: HandbookGuideProps) {
  const inputId = useId();
  const hintId = useId();
  const searching = query.trim().length >= HANDBOOK_SEARCH_MIN;

  return (
    <div className="flex flex-col gap-6">
      <div role="search">
        <label htmlFor={inputId} className="text-body font-medium text-ink">
          Search the handbook
        </label>
        <div className="relative mt-2">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-muted"
          />
          <input
            id={inputId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-describedby={hintId}
            placeholder="e.g. uniform"
            className="h-12 w-full rounded-full border border-input bg-white pr-12 pl-11 text-body text-ink shadow-[inset_0_1px_2px_rgb(0_0_0/0.06)] transition-colors duration-300 placeholder:text-ink-muted hover:border-forest-500 [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear the search"
              className="absolute top-1/2 right-0.5 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted transition-colors duration-300 hover:text-ink focus-visible:text-ink"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          ) : null}
        </div>
        <p id={hintId} className="mt-2 text-small text-ink-muted">
          Finds words on any page, and opens the page.
        </p>
      </div>

      {searching ? (
        <SearchResults query={query.trim()} search={search} onOpen={onOpen} />
      ) : (
        <Contents contents={contents} currentPage={currentPage} onOpen={onOpen} />
      )}
    </div>
  );
}

function SearchResults({
  query,
  search,
  onOpen,
}: {
  query: string;
  search: HandbookSearchModel;
  onOpen: (page: number) => void;
}) {
  return (
    <section aria-labelledby="handbook-results-heading">
      <h2 id="handbook-results-heading" className="sr-only">
        Search results
      </h2>
      <p aria-live="polite" className="text-small text-ink-muted">
        {search.status === 'ready'
          ? search.matches.length === 0
            ? `No page mentions “${query}”. Try another word.`
            : `${search.matches.length} ${search.matches.length === 1 ? 'page matches' : 'pages match'}`
          : search.status === 'loading'
            ? 'Searching…'
            : null}
      </p>
      {search.status === 'error' ? (
        <SectionError
          className="mt-3"
          message="The search could not run. Check your connection and try again."
          onRetry={search.retry}
        />
      ) : search.status === 'ready' && search.matches.length > 0 ? (
        <ol className="mt-3 flex flex-col gap-1">
          {search.matches.map((match) => (
            <li key={match.page}>
              <button type="button" onClick={() => onOpen(match.page)} className={cn(ROW, 'flex-col items-start gap-1')}>
                <span className="text-small font-semibold text-ink">Page {match.page}</span>
                <HighlightedText parts={match.snippet} className="line-clamp-3 text-small text-ink" />
              </button>
            </li>
          ))}
        </ol>
      ) : search.status === 'loading' ? (
        <div aria-hidden="true" className="mt-3 flex flex-col gap-3">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      ) : null}
    </section>
  );
}

function Contents({
  contents,
  currentPage,
  onOpen,
}: {
  contents: HandbookContents;
  currentPage: number;
  onOpen: (page: number) => void;
}) {
  return (
    <nav aria-labelledby="handbook-contents-heading">
      <h2 id="handbook-contents-heading" className="text-body-lg font-semibold text-ink">
        Contents
      </h2>
      {contents.kind === 'outline' ? (
        <ol className="mt-2 flex flex-col">
          {contents.entries.map((entry) => (
            <li key={entry.key}>
              <button
                type="button"
                onClick={() => onOpen(entry.page)}
                aria-current={entry.key === contents.activeKey ? 'true' : undefined}
                className={cn(ROW, entry.depth === 0 ? 'text-body text-ink' : 'text-small text-ink')}
                style={{ paddingLeft: `${0.75 + entry.depth}rem` }}
              >
                <span className="min-w-0 flex-1 text-pretty">{entry.title}</span>
                {' '}
                <span className="shrink-0 text-small text-ink-muted tabular-nums">
                  <span className="sr-only">page {entry.page}</span>
                  <span aria-hidden="true">{entry.page}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : contents.kind === 'thumbnails' ? (
        <>
          <p className="mt-1 text-small text-ink-muted">This edition has no chapter list. Pick a page.</p>
          <ol className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-3">
            {contents.pages.map((page) => (
              <li key={page.number}>
                <button
                  type="button"
                  onClick={() => onOpen(page.number)}
                  aria-current={page.number === currentPage ? 'true' : undefined}
                  className="group flex w-full cursor-pointer flex-col items-center gap-1 rounded-lg p-1 text-small text-ink transition-colors duration-300 hover:bg-white focus-visible:bg-white aria-[current=true]:bg-white aria-[current=true]:font-semibold"
                >
                  <span className="block aspect-[1/1.3] w-full overflow-hidden bg-white shadow-sm ring-1 ring-ink/10 group-aria-[current=true]:ring-2 group-aria-[current=true]:ring-forest-700">
                    {page.src ? (
                      <img
                        src={page.src}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        className="pointer-events-none size-full object-cover object-top"
                      />
                    ) : null}
                  </span>
                  <span>Page {page.number}</span>
                </button>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="mt-2 text-small text-ink-muted">The contents appear once the pages are ready.</p>
      )}
    </nav>
  );
}
