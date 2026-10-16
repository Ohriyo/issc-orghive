import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { documentListResponseSchema, type DocumentSummary } from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

/** Typing pauses this long before a search is sent. */
export const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY = 2;

export interface SearchResult {
  id: string;
  title: string;
  /** Short name of the owning organization, e.g. "JPICE". */
  organization: string;
  organizationName: string;
  typeName: string;
  academicYear: string;
  /** The organization's Paperworks, where the document lives. */
  href: string;
}

export type SearchResults =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string; retry: () => void }
  | { status: 'empty'; query: string }
  | { status: 'ready'; query: string; results: SearchResult[] };

export interface DocumentSearchModel {
  query: string;
  setQuery: (query: string) => void;
  results: SearchResults;
}

export function toSearchResult(doc: DocumentSummary): SearchResult {
  return {
    id: doc.id,
    title: doc.title,
    organization: doc.organization.acronym,
    organizationName: doc.organization.name,
    typeName: doc.type.name,
    academicYear: doc.academicYear,
    href: `/orgs/${doc.organization.slug}/paperworks`,
  };
}

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * Global Paperworks search for the header's search overlay: debounced, at least two
 * characters, best matches first, filtered by what the signed-in user may see.
 */
export function useDocumentSearch(): DocumentSearchModel {
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const enabled = q.length >= MIN_QUERY;

  const search = useQuery({
    queryKey: queryKeys.documents.search(q),
    queryFn: () =>
      api.get(`/documents?q=${encodeURIComponent(q)}&limit=10`, {
        schema: documentListResponseSchema,
      }),
    enabled,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  let results: SearchResults;
  if (query.trim().length < MIN_QUERY) results = { status: 'idle' };
  else if (search.isError) {
    results = {
      status: 'error',
      message: 'Search is not available right now. Check your connection and try again.',
      retry: () => void search.refetch(),
    };
  } else if (!search.data || q !== query.trim()) results = { status: 'loading' };
  else if (search.data.items.length === 0) results = { status: 'empty', query: q };
  else results = { status: 'ready', query: q, results: search.data.items.map(toSearchResult) };

  return { query, setQuery, results };
}
