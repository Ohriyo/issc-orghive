import { Search, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { Link } from 'react-router';
import { Container } from '@/components/container';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import type { DocumentSearchModel, SearchResult } from '../presenters/use-document-search';

export interface SearchOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  search: DocumentSearchModel;
}

/**
 * Full-screen Paperworks search. A modal dialog: focus moves to the field, stays inside
 * until it closes (Esc, the close button or picking a result) and then returns to the
 * button that opened it.
 */
export function SearchOverlay({ open, onOpenChange, search }: SearchOverlayProps) {
  const close = () => onOpenChange(false);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          className="bg-surface-sweep fixed inset-0 z-50 flex flex-col overflow-y-auto overscroll-contain pt-[env(safe-area-inset-top,0px)] pb-safe duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none"
        >
          <Dialog.Title className="sr-only">Search Paperworks</Dialog.Title>
          <Container className="sticky top-0 flex items-center gap-3 border-b border-border bg-surface/95 py-4 backdrop-blur-sm">
            <label className="flex h-14 min-w-0 flex-1 items-center gap-3 rounded-full border border-input bg-white px-5 shadow-pool focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-ink">
              <Search aria-hidden="true" className="size-5 shrink-0 text-ink-muted" />
              <span className="sr-only">Search Paperworks</span>
              <input
                type="search"
                // The dialog moves focus here when it opens.
                autoFocus
                value={search.query}
                onChange={(event) => search.setQuery(event.target.value)}
                placeholder="Search proposals, reports, resolutions"
                enterKeyHint="search"
                className="min-w-0 flex-1 bg-transparent text-body-lg text-ink outline-none placeholder:text-ink-muted/80"
              />
            </label>
            <Dialog.Close
              aria-label="Close search"
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink transition-colors duration-300 hover:bg-white focus-visible:bg-white"
            >
              <X aria-hidden="true" className="size-6" />
            </Dialog.Close>
          </Container>

          <Container className="flex-1 py-6 sm:py-10">
            <SearchResultsView results={search.results} onPick={close} />
          </Container>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SearchResultsView({
  results,
  onPick,
}: {
  results: DocumentSearchModel['results'];
  onPick: () => void;
}) {
  switch (results.status) {
    case 'idle':
      return (
        <p className="max-w-prose text-body text-ink-muted">
          Search every organization&rsquo;s approved Paperworks by title or description. Type at
          least two characters.
        </p>
      );
    case 'loading':
      return (
        <div aria-busy="true">
          <p className="sr-only">Searching</p>
          <ul className="space-y-3">
            {[0, 1, 2].map((i) => (
              <li key={i}>
                <Skeleton className="h-20 w-full rounded-xl" />
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
            {results.results.length === 1 ? '1 result' : `${results.results.length} results`} for
            &ldquo;{results.query}&rdquo;
          </p>
          <ul className="grid gap-3 md:grid-cols-2">
            {results.results.map((result) => (
              <li key={result.id}>
                <ResultLink result={result} onPick={onPick} />
              </li>
            ))}
          </ul>
        </>
      );
  }
}

function ResultLink({ result, onPick }: { result: SearchResult; onPick: () => void }) {
  return (
    <Link
      to={result.href}
      onClick={onPick}
      className="ease-cinematic block min-h-11 rounded-xl bg-white p-4 shadow-pool ring-1 ring-ink/10 transition-[translate,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-pool-lift focus-visible:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:focus-visible:translate-y-0"
    >
      <span className="block text-body font-semibold text-pretty text-ink">{result.title}</span>
      <span className="mt-1 block text-small text-ink-muted">
        <abbr title={result.organizationName} className="font-medium text-ink no-underline">
          {result.organization}
        </abbr>
        , {result.typeName}, {result.academicYear}
      </span>
    </Link>
  );
}
