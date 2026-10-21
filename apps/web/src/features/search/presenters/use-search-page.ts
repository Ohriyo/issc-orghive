import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  HANDBOOK_DOCUMENT_TYPE,
  collegeDetailSchema,
  collegeListResponseSchema,
  documentTypeListResponseSchema,
  organizationDetailSchema,
  SEARCH_MIN_QUERY,
  searchResponseSchema,
  type OrganizationSummary,
  type SearchHit,
  type SearchSnippet,
} from '@orghive/shared';
import type { FilterBarModel, FilterOption } from '@/components/filter-bar';
import {
  toDocumentCard,
  yearOptions,
  type PaperworksCard,
} from '@/features/paperworks/presenters/use-paperworks';
import { yearLabel } from '@/features/handbook/presenters/use-handbook';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

const FIVE_MINUTES = 5 * 60_000;
const PAGE_SIZE = 12;
const SEARCH_DEBOUNCE_MS = 300;
/** The university-wide council; the header and home page link to it by this slug too. */
const ISSC_SLUG = 'issc';

export interface SearchFilters {
  q: string;
  /** College slug, e.g. "cea". */
  college: string;
  /** Organization slug. */
  org: string;
  /** Document type slug. */
  type: string;
  year: string;
}

export type SearchSelect = Exclude<keyof SearchFilters, 'q'>;

export interface SearchFilterModel extends FilterBarModel<SearchSelect> {
  values: SearchFilters;
  options: Record<'colleges' | 'orgs' | 'types' | 'years', FilterOption[]>;
}

export type SearchHitCard = PaperworksCard & {
  /** The passage that matched, matched words marked. */
  excerpt: SearchSnippet | null;
};

export interface SearchPageResults {
  /** `idle` until at least two characters are typed. */
  status: 'idle' | 'loading' | 'error' | 'empty' | 'ready';
  query: string;
  items: SearchHitCard[];
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  retry: () => void;
  /** Matching pages of the current Student Handbook, above the documents; null when none. */
  handbook: {
    yearLabel: string;
    matches: { page: number; snippet: SearchSnippet; href: string }[];
  } | null;
}

export interface SearchPageState {
  filters: SearchFilterModel;
  results: SearchPageResults;
}

export function toSearchHitCard({ document: doc, snippet }: SearchHit): SearchHitCard {
  return {
    ...toDocumentCard(doc),
    thumbnailSrc: doc.currentVersion?.thumbnailUrl ?? undefined,
    org: { name: doc.organization.name, shortName: doc.organization.acronym },
    excerpt: snippet,
  };
}

function readFilters(params: URLSearchParams): SearchFilters {
  return {
    q: params.get('q') ?? '',
    college: params.get('college') ?? '',
    org: params.get('org') ?? '',
    type: params.get('type') ?? '',
    year: params.get('year') ?? '',
  };
}

const orgOption = (org: OrganizationSummary): FilterOption => ({
  value: org.slug,
  label: org.acronym,
});

/**
 * Presenter for /search: every Paperworks document the viewer may see, best matches first,
 * 12 at a time. The query and filters live in the URL, so a search can be shared as a link.
 * Choosing a college lists its CSC and SBOs as organizations; without one, the ISSC and the
 * CSCs.
 */
export function useSearchPage(): SearchPageState {
  const [params, setParams] = useSearchParams();
  const values = readFilters(params);
  const [searchInput, setSearchInput] = useState(values.q);

  // The URL, and so the query, follows the search box after a pause in typing.
  useEffect(() => {
    if (searchInput.trim() === values.q) return;
    const timer = setTimeout(() => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (searchInput.trim()) next.set('q', searchInput.trim());
          else next.delete('q');
          return next;
        },
        { replace: true },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, values.q, setParams]);

  const colleges = useQuery({
    queryKey: queryKeys.colleges.list,
    queryFn: () => api.get('/colleges', { schema: collegeListResponseSchema }),
    staleTime: FIVE_MINUTES,
  });
  const college = useQuery({
    queryKey: queryKeys.colleges.detail(values.college),
    queryFn: () => api.get(`/colleges/${values.college}`, { schema: collegeDetailSchema }),
    enabled: !!values.college,
    staleTime: FIVE_MINUTES,
  });
  const issc = useQuery({
    queryKey: queryKeys.organizations.detail(ISSC_SLUG),
    queryFn: () => api.get(`/organizations/${ISSC_SLUG}`, { schema: organizationDetailSchema }),
    enabled: !values.college,
    staleTime: FIVE_MINUTES,
  });
  const types = useQuery({
    queryKey: queryKeys.documents.types,
    queryFn: () => api.get('/document-types', { schema: documentTypeListResponseSchema }),
    staleTime: FIVE_MINUTES,
  });

  const filters = {
    q: values.q,
    college: values.college || undefined,
    org: values.org || undefined,
    type: values.type || undefined,
    year: values.year || undefined,
  };
  const enabled = values.q.length >= SEARCH_MIN_QUERY;
  const search = useInfiniteQuery({
    queryKey: queryKeys.documents.searchResults(filters),
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(pageParam) });
      for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
      return api.get(`/search?${query.toString()}`, { schema: searchResponseSchema });
    },
    initialPageParam: 1,
    getNextPageParam: (last) => last.nextPage ?? undefined,
    enabled,
    staleTime: 60_000,
  });

  const set: SearchFilterModel['set'] = (name, value) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(name, value);
        else next.delete(name);
        // An organization belongs to one college: a new college drops the old choice.
        if (name === 'college') next.delete('org');
        return next;
      },
      { replace: true },
    );

  const orgs: FilterOption[] = values.college
    ? [college.data?.csc, ...(college.data?.sbos ?? [])].flatMap((o) => (o ? [orgOption(o)] : []))
    : [issc.data, ...(colleges.data?.colleges.map((c) => c.csc) ?? [])].flatMap((o) =>
        o ? [orgOption(o)] : [],
      );
  // An organization from a shared link stays selectable before (or without) its college.
  if (values.org && !orgs.some((o) => o.value === values.org)) {
    orgs.push({ value: values.org, label: values.org.toUpperCase() });
  }

  const items = search.data?.pages.flatMap((page) => page.items.map(toSearchHitCard)) ?? [];
  const handbookHits = search.data?.pages[0]?.handbook ?? null;
  const handbook = handbookHits
    ? {
        yearLabel: yearLabel(handbookHits.academicYear),
        matches: handbookHits.matches.map((m) => ({
          ...m,
          href: `/handbook?page=${m.page}&q=${encodeURIComponent(values.q)}`,
        })),
      }
    : null;
  const status: SearchPageResults['status'] = !enabled
    ? 'idle'
    : search.isError
      ? 'error'
      : !search.data
        ? 'loading'
        : items.length === 0 && !handbook
          ? 'empty'
          : 'ready';

  return {
    filters: {
      values,
      searchInput,
      setSearchInput,
      set,
      // Clears the filters, not the query: the search box is the page's main field.
      clear: () =>
        setParams(values.q ? new URLSearchParams({ q: values.q }) : new URLSearchParams(), {
          replace: true,
        }),
      activeCount: [values.college, values.org, values.type, values.year].filter(Boolean).length,
      options: {
        colleges: (colleges.data?.colleges ?? []).map((c) => ({ value: c.slug, label: c.code })),
        orgs,
        // The handbook has its own block above the results; it is never a filter.
        types: (types.data?.types ?? [])
          .filter((t) => t.slug !== HANDBOOK_DOCUMENT_TYPE.slug)
          .map((t) => ({ value: t.slug, label: t.name })),
        years: yearOptions(new Date()),
      },
    },
    results: {
      status,
      query: values.q,
      items,
      hasMore: !!search.hasNextPage,
      isLoadingMore: search.isFetchingNextPage,
      loadMore: () => void search.fetchNextPage(),
      retry: () => void search.refetch(),
      handbook,
    },
  };
}
