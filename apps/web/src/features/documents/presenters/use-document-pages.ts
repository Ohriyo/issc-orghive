import { useQuery } from '@tanstack/react-query';
import { documentViewerResponseSchema, type DocumentViewerResponse } from '@orghive/shared';
import { api, apiUrl } from '@/lib/api';

/** While the worker renders the pages, check back this often. */
const PREPARING_POLL_MS = 5_000;
/** Ask for a fresh page token this long before the current one expires. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;
/** Tokens last 5 minutes; never wait longer than that, whatever the clock says. */
const MAX_REFRESH_MS = 5 * 60_000;

export interface ViewerPage {
  /** 1-based. */
  number: number;
  width: number;
  height: number;
  /** The watermarked image, signed for 5 minutes. */
  src: string;
}

export type DocumentPagesModel =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  /** The worker has not rendered the pages yet: "Preparing preview…". */
  | { status: 'preparing' }
  /** The file could not be rendered (damaged, encrypted) or was refused by the scan. */
  | { status: 'unavailable' }
  | {
      status: 'ready';
      pages: ViewerPage[];
      /** How many pages the file has; more than `pages.length` when the preview is capped. */
      totalPages: number;
      /** A page image failed (usually an expired token): fetch a fresh token. */
      refresh: () => void;
    };

/** When to fetch the viewer again: soon while preparing, before the token expires when ready. */
export function nextViewerRefresh(data: DocumentViewerResponse | undefined, now = Date.now()) {
  if (!data) return false;
  if (data.status === 'pending') return PREPARING_POLL_MS;
  if (data.status !== 'ready' || !data.expiresAt) return false;
  const untilRefresh = new Date(data.expiresAt).getTime() - now - TOKEN_REFRESH_MARGIN_MS;
  return Math.min(MAX_REFRESH_MS, Math.max(10_000, untilRefresh));
}

export function pageSrc(documentId: string, page: number, token: string): string {
  return apiUrl(`/documents/${documentId}/pages/${page}?token=${encodeURIComponent(token)}`);
}

/**
 * Presenter for the view-only viewer: the current version's watermarked pages and a signed
 * token for them (5 minutes, renewed before it runs out). Nobody but the owning organization
 * ever gets the original file; this is how everyone views it.
 */
export function useDocumentPages(documentId: string, versionId?: string): DocumentPagesModel {
  const query = useQuery({
    queryKey: ['documents', 'viewer', documentId, versionId ?? 'current'],
    queryFn: () =>
      api.get(`/documents/${documentId}/viewer${versionId ? `?versionId=${versionId}` : ''}`, {
        schema: documentViewerResponseSchema,
        background: true,
      }),
    enabled: documentId !== '',
    refetchInterval: (q) => nextViewerRefresh(q.state.data),
    // A remount after the token has gone stale fetches a fresh one.
    staleTime: 60_000,
  });

  if (query.isPending) return { status: 'loading' };
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  const data = query.data;
  if (data.status === 'pending') return { status: 'preparing' };
  if (data.status === 'failed' || !data.token || data.pages.length === 0) {
    return { status: 'unavailable' };
  }
  const token = data.token;
  return {
    status: 'ready',
    pages: data.pages.map((p, i) => ({
      number: i + 1,
      width: p.width,
      height: p.height,
      src: pageSrc(documentId, i + 1, token),
    })),
    totalPages: data.totalPages,
    refresh: () => {
      if (!query.isFetching) void query.refetch();
    },
  };
}
