import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  SEARCH_MIN_QUERY,
  searchResponseSchema,
  type SearchHit,
  type SearchSnippet,
} from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useSearchHotkey } from './use-search-hotkey';

/** Typing pauses this long before a search is sent. */
export const SEARCH_DEBOUNCE_MS = 250;
/** The overlay shows the best few; "See all results" opens /search for the rest. */
const INSTANT_LIMIT = 8;

export interface SearchResult {
  id: string;
  title: string;
  /** Short name of the owning organization, e.g. "JPICE". */
  organization: string;
  organizationName: string;
  typeName: string;
  academicYear: string;
  /** The document's own page. */
  href: string;
  /** The passage that matched, with matched words marked. */
  snippet: SearchSnippet | null;
}

export type SearchResults =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string; retry: () => void }
  | { status: 'empty'; query: string }
  | {
      status: 'ready';
      query: string;
      results: SearchResult[];
      /** Set when there are more results than the overlay shows. */
      hasMore: boolean;
    };

export interface DocumentSearchModel {
  /** Whether the search overlay is open. Cmd/Ctrl+K opens it from any page. */
  open: boolean;
  setOpen: (open: boolean) => void;
  query: string;
  setQuery: (query: string) => void;
  results: SearchResults;
  /** The full results page for what is typed, with filters. */
  allResultsHref: string;
  /** Enter in the search box: closes the overlay and opens the full results page. */
  submit: () => void;
  /** How the shortcut reads on this device: "⌘K" on Apple devices, "Ctrl K" elsewhere. */
  shortcut: string;
}

export function toSearchResult({ document: doc, snippet }: SearchHit): SearchResult {
  return {
    id: doc.id,
    title: doc.title,
    organization: doc.organization.acronym,
    organizationName: doc.organization.name,
    typeName: doc.type.name,
    academicYear: doc.academicYear,
    href: `/documents/${doc.id}`,
    snippet,
  };
}

export function searchPageHref(query: string): string {
  const q = query.trim();
  return q ? `/search?${new URLSearchParams({ q }).toString()}` : '/search';
}

function shortcutLabel(): string {
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform;
  return /mac|iphone|ipad/i.test(platform) ? '⌘K' : 'Ctrl K';
}

export function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * Instant Paperworks search for the header's search overlay: debounced, at least two
 * characters, best matches first, filtered by what the signed-in user may see.
 */
export function useDocumentSearch(): DocumentSearchModel {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const enabled = q.length >= SEARCH_MIN_QUERY;
  useSearchHotkey(() => setOpen(true));

  const search = useQuery({
    queryKey: queryKeys.documents.search(q),
    queryFn: () =>
      api.get(`/search?${new URLSearchParams({ q, limit: String(INSTANT_LIMIT) }).toString()}`, {
        schema: searchResponseSchema,
      }),
    enabled,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  let results: SearchResults;
  if (query.trim().length < SEARCH_MIN_QUERY) results = { status: 'idle' };
  else if (search.isError) {
    results = {
      status: 'error',
      message: 'Search is not available right now. Check your connection and try again.',
      retry: () => void search.refetch(),
    };
  } else if (!search.data || q !== query.trim()) results = { status: 'loading' };
  else if (search.data.items.length === 0) results = { status: 'empty', query: q };
  else {
    results = {
      status: 'ready',
      query: q,
      results: search.data.items.map(toSearchResult),
      hasMore: search.data.nextPage !== null,
    };
  }

  const allResultsHref = searchPageHref(query);
  return {
    open,
    setOpen,
    query,
    setQuery,
    results,
    allResultsHref,
    submit: () => {
      if (query.trim().length < SEARCH_MIN_QUERY) return;
      setOpen(false);
      void navigate(allResultsHref);
    },
    shortcut: shortcutLabel(),
  };
}
