import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  documentListResponseSchema,
  documentTypeListResponseSchema,
  organizationDetailSchema,
  paperworksSeo,
  SEMESTERS,
  type PageSeo,
  type DocumentSummary,
  type Semester,
} from '@orghive/shared';
import type { DocumentCardProps, DocumentFileType } from '@/components/document-card';
import type { FilterBarModel, FilterOption } from '@/components/filter-bar';
import { isOwnOrganization, useAuth } from '@/features/auth/presenters/use-auth';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

const FIVE_MINUTES = 5 * 60_000;
const PAGE_SIZE = 12;
/** A document counts as new for two weeks after it was submitted. */
const NEW_FOR_MS = 14 * 24 * 60 * 60 * 1000;
/** How many academic years back the year filter offers. */
const YEARS_BACK = 5;
const SEARCH_DEBOUNCE_MS = 300;

const MIME_TO_FILE_TYPE: Record<string, DocumentFileType> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

export const SEMESTER_LABELS: Record<Semester, string> = {
  first: 'First semester',
  second: 'Second semester',
  midyear: 'Midyear',
};

export interface PaperworksFilters {
  q: string;
  /** Document type slug. */
  type: string;
  year: string;
  semester: string;
}

export type { FilterOption };

export type SelectFilter = Exclude<keyof PaperworksFilters, 'q'>;

export interface PaperworksFilterModel extends FilterBarModel<SelectFilter> {
  values: PaperworksFilters;
  options: Record<'types' | 'years' | 'semesters', FilterOption[]>;
}

export type PaperworksCard = DocumentCardProps & { id: string };

export interface PaperworksDocuments {
  status: 'loading' | 'error' | 'empty' | 'ready';
  items: PaperworksCard[];
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  retry: () => void;
}

export type PaperworksState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; retry: () => void }
  | {
      status: 'ready';
      org: { acronym: string; name: string; href: string };
      /** Title and description for search engines and link previews. */
      seo: PageSeo;
      /** Set for the organization's officers (and admins): where to upload. */
      uploadHref?: string;
      filters: PaperworksFilterModel;
      documents: PaperworksDocuments;
    };

/** "2026-2027" for the academic year containing `now` (it starts in August). */
export function academicYearOf(now: Date): string {
  const start = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}-${start + 1}`;
}

/** The current academic year and the ones before it, newest first. */
export function yearOptions(now: Date, count = YEARS_BACK): FilterOption[] {
  const start = Number(academicYearOf(now).slice(0, 4));
  return Array.from({ length: count }, (_, i) => {
    const year = `${start - i}-${start - i + 1}`;
    return { value: year, label: year };
  });
}

/** Shapes a document for DocumentCard. Status shows only when it is not plainly available. */
export function toDocumentCard(doc: DocumentSummary, now = Date.now()): PaperworksCard {
  const shown = doc.createdAt;
  return {
    id: doc.id,
    title: doc.title,
    typeLabel: doc.type.name,
    date: shown,
    href: `/documents/${doc.id}`,
    fileType: doc.currentVersion ? MIME_TO_FILE_TYPE[doc.currentVersion.mimeType] : undefined,
    isNew: now - new Date(shown).getTime() < NEW_FOR_MS,
    status: doc.status === 'available' ? undefined : doc.status,
  };
}

function readFilters(params: URLSearchParams): PaperworksFilters {
  return {
    q: params.get('q') ?? '',
    type: params.get('type') ?? '',
    year: params.get('year') ?? '',
    semester: params.get('semester') ?? '',
  };
}

/**
 * Presenter for /orgs/:slug/paperworks: the organization, its documents (12 at a time,
 * newest first, or by relevance while searching) and filters kept in the URL, so a
 * filtered list can be shared as a link.
 */
export function usePaperworks(slug: string): PaperworksState {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
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

  const org = useQuery({
    queryKey: queryKeys.organizations.detail(slug),
    queryFn: () => api.get(`/organizations/${slug}`, { schema: organizationDetailSchema }),
    staleTime: FIVE_MINUTES,
  });
  const types = useQuery({
    queryKey: queryKeys.documents.types,
    queryFn: () => api.get('/document-types', { schema: documentTypeListResponseSchema }),
    staleTime: FIVE_MINUTES,
  });

  const typeId = types.data?.types.find((t) => t.slug === values.type)?.id;
  // Wait for the type list before filtering by a type from the URL.
  const typeReady = !values.type || !!typeId || types.isError;
  const listFilters = {
    q: values.q || undefined,
    typeId,
    academicYear: values.year || undefined,
    semester: values.semester || undefined,
  };
  const documents = useInfiniteQuery({
    queryKey: queryKeys.documents.list(slug, listFilters),
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
      for (const [key, value] of Object.entries(listFilters)) if (value) query.set(key, value);
      if (pageParam) query.set('cursor', pageParam);
      return api.get(`/organizations/${slug}/documents?${query.toString()}`, {
        schema: documentListResponseSchema,
      });
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: org.isSuccess && typeReady,
    staleTime: 60_000,
  });

  if (org.error instanceof ApiError && [400, 404].includes(org.error.status)) {
    return { status: 'not-found' };
  }
  if (org.isError) return { status: 'error', retry: () => void org.refetch() };
  if (!org.data) return { status: 'loading' };

  const set: PaperworksFilterModel['set'] = (name, value) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(name, value);
        else next.delete(name);
        return next;
      },
      { replace: true },
    );

  const items =
    documents.data?.pages.flatMap((page) => page.items.map((doc) => toDocumentCard(doc))) ?? [];
  const docStatus: PaperworksDocuments['status'] = documents.isError
    ? 'error'
    : !documents.data
      ? 'loading'
      : items.length === 0
        ? 'empty'
        : 'ready';

  return {
    status: 'ready',
    org: { acronym: org.data.acronym, name: org.data.name, href: `/orgs/${org.data.slug}` },
    seo: paperworksSeo(org.data),
    uploadHref: isOwnOrganization(user, { id: org.data.id })
      ? `/orgs/${org.data.slug}/paperworks/upload`
      : undefined,
    filters: {
      values,
      searchInput,
      setSearchInput,
      set,
      clear: () => {
        setSearchInput('');
        setParams(new URLSearchParams(), { replace: true });
      },
      activeCount: [values.q, values.type, values.year, values.semester].filter(Boolean).length,
      options: {
        types: (types.data?.types ?? []).map((t) => ({ value: t.slug, label: t.name })),
        years: yearOptions(new Date()),
        semesters: SEMESTERS.map((s) => ({ value: s, label: SEMESTER_LABELS[s] })),
      },
    },
    documents: {
      status: docStatus,
      items,
      hasMore: !!documents.hasNextPage,
      isLoadingMore: documents.isFetchingNextPage,
      loadMore: () => void documents.fetchNextPage(),
      retry: () => void documents.refetch(),
    },
  };
}
