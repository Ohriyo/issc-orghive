import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import {
  adminHandbookResponseSchema,
  downloadUrlResponseSchema,
  HANDBOOK_SEARCH_MIN,
  handbookResponseSchema,
  handbookSearchResponseSchema,
  type HandbookEdition,
  type HandbookOutlineItem,
  type HandbookPageMatch,
} from '@orghive/shared';
import {
  useDocumentPages,
  type DocumentPagesModel,
} from '@/features/documents/presenters/use-document-pages';
import { useAuth } from '@/features/auth/presenters/use-auth';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

const FIVE_MINUTES = 5 * 60_000;
const SEARCH_DELAY_MS = 250;
/** While no edition is readable yet (the first one is in its virus scan), look again this often. */
export const NOTHING_YET_POLL_MS = 15_000;

/**
 * Handbook reads always ask the server, which answers 304 when nothing changed. The browser's
 * own HTTP cache (the public max-age) would otherwise hand back "no edition yet" for minutes
 * after one is published, even on reload.
 */
export const REVALIDATE = { cache: 'no-cache' } as const satisfies RequestInit;

/** Polls a "no edition yet" answer until an edition is readable. */
export const pollWhileNothing = (q: { state: { data?: { edition: unknown } } }) =>
  q.state.data?.edition === null ? NOTHING_YET_POLL_MS : false;

/** "2026-2027" → "2026–2027", as the year is written for reading. */
export function yearLabel(academicYear: string): string {
  return academicYear.replace('-', '–');
}

/** The bookmarks in reading order, each with its depth (0 = top level). */
export interface ContentsEntry {
  key: string;
  title: string;
  page: number;
  depth: number;
}

export function flattenOutline(items: HandbookOutlineItem[], depth = 0, prefix = ''): ContentsEntry[] {
  return items.flatMap((item, i) => {
    const key = `${prefix}${i}`;
    return [
      { key, title: item.title, page: item.page, depth },
      ...flattenOutline(item.items, depth + 1, `${key}.`),
    ];
  });
}

/** The entry a reader on `page` is in: the last one starting on or before it. */
export function activeEntryKey(entries: ContentsEntry[], page: number): string | null {
  let found: string | null = null;
  for (const entry of entries) {
    if (entry.page <= page) found = entry.key;
  }
  return found;
}

/** A page to jump to; `nonce` makes asking for the same page twice jump again. */
export interface JumpRequest {
  page: number;
  nonce: number;
}

export type HandbookContents =
  | { kind: 'outline'; entries: ContentsEntry[]; activeKey: string | null }
  | { kind: 'thumbnails'; pages: { number: number; src: string | null }[] }
  | { kind: 'none' };

export type HandbookSearchModel =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; matches: HandbookPageMatch[] };

export type HandbookModel =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  /** Nothing published yet (current), or no such edition (a year). */
  | { status: 'none'; year: string | null }
  | {
      status: 'ready';
      edition: HandbookEdition;
      yearLabel: string;
      /** Shown when reading a past edition: where the current one is. */
      isPast: boolean;
      pages: DocumentPagesModel;
      contents: HandbookContents;
      currentPage: number;
      onPageChange: (page: number) => void;
      jump: JumpRequest | null;
      goTo: (page: number) => void;
      query: string;
      setQuery: (q: string) => void;
      search: HandbookSearchModel;
      /** The ISSC account only (the owner): saves the original PDF. Null for everyone else. */
      download: (() => void) | null;
      downloadError: string | undefined;
      /** The ISSC account only, when the pages could not be prepared: queues them again. */
      retryRendering: RetryRendering | null;
    };

export interface RetryRendering {
  run: () => void;
  busy: boolean;
  error: string | undefined;
}

/**
 * /handbook (the current edition) and /handbook/:year: the watermarked pages, the contents
 * (the PDF's bookmarks, else page thumbnails), and search inside it that jumps to the page.
 * `?page=` opens at a page (the site search links there), `?q=` starts a search.
 */
export function useHandbook(year: string | null): HandbookModel {
  const [params] = useSearchParams();
  const initialPage = Number.parseInt(params.get('page') ?? '', 10);
  const [jump, setJump] = useState<JumpRequest | null>(
    Number.isFinite(initialPage) && initialPage > 0 ? { page: initialPage, nonce: 0 } : null,
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [downloadError, setDownloadError] = useState<string>();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string>();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // The handbook is the ISSC's document: its account is the one owner who may download it.
  const isOwner = user?.organization?.type === 'ISSC';
  const [debounced, setDebounced] = useState(query.trim());

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(id);
  }, [query]);

  const editionQuery = useQuery({
    queryKey: queryKeys.handbook.edition(year),
    queryFn: () =>
      api.get(year ? `/handbook/${year}` : '/handbook', {
        schema: handbookResponseSchema,
        ...REVALIDATE,
      }),
    staleTime: FIVE_MINUTES,
    refetchInterval: pollWhileNothing,
  });
  const edition = editionQuery.data?.edition ?? null;
  const pages = useDocumentPages(edition?.documentId ?? '');

  const searching = debounced.length >= HANDBOOK_SEARCH_MIN && edition !== null;
  const searchQuery = useQuery({
    queryKey: queryKeys.handbook.search(year, debounced.toLowerCase()),
    queryFn: () =>
      api.get(
        `${year ? `/handbook/${year}` : '/handbook'}/search?q=${encodeURIComponent(debounced)}`,
        { schema: handbookSearchResponseSchema },
      ),
    enabled: searching,
    staleTime: FIVE_MINUTES,
    placeholderData: keepPreviousData,
  });

  const entries = edition?.outline ? flattenOutline(edition.outline) : [];

  if (editionQuery.isPending) return { status: 'loading' };
  if (editionQuery.error instanceof ApiError && [400, 404].includes(editionQuery.error.status)) {
    return { status: 'none', year };
  }
  if (editionQuery.isError) return { status: 'error', retry: () => void editionQuery.refetch() };
  if (!edition) return { status: 'none', year };

  const contents: HandbookContents =
    entries.length > 0
      ? { kind: 'outline', entries, activeKey: activeEntryKey(entries, currentPage) }
      : edition.thumbnails && pages.status === 'ready'
        ? {
            kind: 'thumbnails',
            pages: pages.pages.map((p) => ({ number: p.number, src: `${p.src}&size=thumb` })),
          }
        : { kind: 'none' };

  const search: HandbookSearchModel = !searching
    ? { status: 'idle' }
    : searchQuery.isError
      ? { status: 'error', retry: () => void searchQuery.refetch() }
      : searchQuery.data
        ? { status: 'ready', matches: searchQuery.data.matches }
        : { status: 'loading' };

  return {
    status: 'ready',
    edition,
    yearLabel: yearLabel(edition.academicYear),
    isPast: !edition.isCurrent,
    pages,
    contents,
    currentPage,
    onPageChange: setCurrentPage,
    jump,
    goTo: (page) => setJump((prev) => ({ page, nonce: (prev?.nonce ?? 0) + 1 })),
    query,
    setQuery,
    search,
    download: isOwner
      ? () => {
          setDownloadError(undefined);
          api
            .get(`/documents/${edition.documentId}/versions/${edition.versionId}/download-url`, {
              schema: downloadUrlResponseSchema,
            })
            .then((link) => window.location.assign(link.url))
            .catch(() => setDownloadError('The download could not start. Try again in a moment.'));
        }
      : null,
    downloadError,
    retryRendering:
      isOwner && pages.status === 'unavailable'
        ? {
            run: () => {
              setRetrying(true);
              setRetryError(undefined);
              api
                .post(`/admin/handbook/${edition.academicYear}/preview/retry`, undefined, {
                  schema: adminHandbookResponseSchema,
                })
                .then(() =>
                  Promise.all([
                    queryClient.invalidateQueries({ queryKey: ['documents', 'viewer', edition.documentId] }),
                    queryClient.invalidateQueries({ queryKey: queryKeys.handbook.all }),
                  ]),
                )
                .catch((error: unknown) =>
                  setRetryError(
                    error instanceof ApiError && error.status === 409
                      ? error.message
                      : 'The pages could not be queued again. Try again in a moment.',
                  ),
                )
                .finally(() => setRetrying(false));
            },
            busy: retrying,
            error: retryError,
          }
        : null,
  };
}
