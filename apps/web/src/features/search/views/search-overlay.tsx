import { useRef } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { Link } from 'react-router';
import { OriginLink } from '@/navigation/origin-link';
import { Container } from '@/components/container';
import { HighlightedText } from '@/components/highlighted-text';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import type { DocumentSearchModel, SearchResult } from '../presenters/use-document-search';

export interface SearchOverlayProps {
  search: DocumentSearchModel;
}

const TEXT_LINK =
  'tap-area inline-flex items-center gap-1.5 text-body font-semibold text-ink underline decoration-1 underline-offset-4 hover:decoration-leaf focus-visible:decoration-leaf';

/**
 * Command-palette style Paperworks search, opened from the header or with Cmd/Ctrl+K. A
 * modal dialog: focus moves to the field, stays inside until it closes (Esc, the close
 * button or picking a result) and then returns to where it was. Enter opens the full
 * results page.
 */
export function SearchOverlay({ search }: SearchOverlayProps) {
  const close = () => search.setOpen(false);
  // Opened by a button or by Cmd/Ctrl+K, never by a Dialog.Trigger, so Radix has nothing
  // to return focus to: remember what had focus and go back there on close.
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={search.open} onOpenChange={search.setOpen}>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            returnFocus.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            const target = returnFocus.current;
            if (target?.isConnected) {
              event.preventDefault();
              target.focus();
            }
          }}
          className="bg-surface-sweep fixed inset-0 z-50 flex flex-col overflow-y-auto overscroll-contain pt-[env(safe-area-inset-top,0px)] pb-safe duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none"
        >
          <Dialog.Title className="sr-only">Search Paperworks</Dialog.Title>
          <Container className="sticky top-0 flex items-center gap-3 border-b border-border bg-surface/95 py-4 backdrop-blur-sm">
            <form
              role="search"
              className="min-w-0 flex-1"
              onSubmit={(event) => {
                event.preventDefault();
                search.submit();
              }}
            >
              <label className="flex h-14 min-w-0 items-center gap-3 rounded-full border border-input bg-white px-5 shadow-pool focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-ink">
                <Search aria-hidden="true" className="size-5 shrink-0 text-ink-muted" />
                <span className="sr-only">Search Paperworks</span>
                <input
                  type="search"
                  // The dialog moves focus here (its first field) once it has noted where
                  // focus was; autoFocus would move it before that.
                  value={search.query}
                  onChange={(event) => search.setQuery(event.target.value)}
                  placeholder="Search proposals, reports, resolutions"
                  enterKeyHint="search"
                  className="min-w-0 flex-1 bg-transparent text-body-lg text-ink outline-none placeholder:text-ink-muted/80"
                />
                <kbd
                  aria-hidden="true"
                  className="hidden shrink-0 rounded-md border border-border bg-surface px-2 py-0.5 font-sans text-caption text-ink-muted md:inline"
                >
                  Esc
                </kbd>
              </label>
            </form>
            <Dialog.Close
              aria-label="Close search"
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink transition-colors duration-300 hover:bg-white focus-visible:bg-white"
            >
              <X aria-hidden="true" className="size-6" />
            </Dialog.Close>
          </Container>

          <Container className="flex-1 py-6 sm:py-10">
            <SearchResultsView search={search} onPick={close} />
          </Container>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SearchResultsView({
  search,
  onPick,
}: {
  search: DocumentSearchModel;
  onPick: () => void;
}) {
  const { results } = search;
  switch (results.status) {
    case 'idle':
      return (
        <div className="max-w-prose space-y-2 text-body text-ink-muted">
          <p>
            Search every organization&rsquo;s Paperworks you can see: titles, tags, descriptions and
            the text inside PDFs. Type at least two characters.
          </p>
          <p className="hidden md:block">
            Press{' '}
            <kbd className="rounded-md border border-border bg-white px-1.5 py-0.5 font-sans text-caption text-ink">
              {search.shortcut}
            </kbd>{' '}
            on any page to search.
          </p>
        </div>
      );
    case 'loading':
      return (
        <div aria-busy="true">
          <p className="sr-only">Searching</p>
          <ul className="space-y-3">
            {[0, 1, 2].map((i) => (
              <li key={i}>
                <Skeleton className="h-24 w-full rounded-xl" />
              </li>
            ))}
          </ul>
        </div>
      );
    case 'error':
      return <SectionError message={results.message} onRetry={results.retry} />;
    case 'empty':
      return (
        <p role="status" className="max-w-prose text-body text-ink">
          No Paperworks match &ldquo;{results.query}&rdquo;. Try another word, or browse an
          organization&rsquo;s Paperworks from its page.
        </p>
      );
    case 'ready':
      return (
        <>
          <p role="status" className="mb-4 text-small text-ink-muted">
            {results.hasMore
              ? `Best matches for “${results.query}”`
              : results.results.length === 1
                ? `1 result for “${results.query}”`
                : `${results.results.length} results for “${results.query}”`}
          </p>
          <ul className="grid gap-3 md:grid-cols-2">
            {results.results.map((result) => (
              <li key={result.id}>
                <ResultLink result={result} onPick={onPick} />
              </li>
            ))}
          </ul>
          <p className="mt-6">
            <Link to={search.allResultsHref} onClick={onPick} className={TEXT_LINK}>
              {results.hasMore ? 'See all results and filters' : 'Filter these results'}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </p>
        </>
      );
  }
}

function ResultLink({ result, onPick }: { result: SearchResult; onPick: () => void }) {
  return (
    <OriginLink
      to={result.href}
      onClick={onPick}
      className="ease-cinematic block h-full min-h-11 rounded-xl bg-white p-4 shadow-pool ring-1 ring-ink/10 transition-[translate,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-pool-lift focus-visible:-translate-y-0.5 focus-visible:shadow-pool-lift motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:focus-visible:translate-y-0"
    >
      <span className="block text-body font-semibold text-pretty text-ink">{result.title}</span>
      <span className="mt-1 block text-small text-ink-muted">
        <abbr title={result.organizationName} className="font-medium text-ink no-underline">
          {result.organization}
        </abbr>
        , {result.typeName}, {result.academicYear}
      </span>
      {result.snippet && result.snippet.length > 0 ? (
        <span className="mt-2 line-clamp-3 text-small text-pretty text-ink">
          <HighlightedText parts={result.snippet} />
        </span>
      ) : null}
    </OriginLink>
  );
}
