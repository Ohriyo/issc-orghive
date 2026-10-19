import { useEffect, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  dashboardResponseSchema,
  documentListResponseSchema,
  documentStatusSchema,
  documentSummarySchema,
  documentTypeListResponseSchema,
  documentVisibilitySchema,
  type DocumentCounts,
  type DocumentMetadata,
  type DocumentStatus,
  type DocumentSummary,
  type DocumentType,
  type DocumentVisibility,
  type UpdateDocumentRequest,
} from '@orghive/shared';
import { STATUS_STYLE } from '@/components/status-style';
import { VISIBILITY_LABEL } from '@/components/visibility';
import { useSetVisibility } from '@/features/documents/presenters/use-set-visibility';
import {
  SEMESTER_LABELS,
  yearOptions,
  type FilterOption,
} from '@/features/paperworks/presenters/use-paperworks';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { OrgRef } from './use-dashboard';

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;

export type StatusTab = DocumentStatus | 'all';
/** The lifecycle, in order. Nothing is reviewed: a file is scanned, then available. */
export const STATUS_TABS: StatusTab[] = ['all', 'available', 'scanning', 'quarantined', 'archived'];

export function tabLabel(tab: StatusTab): string {
  if (tab === 'all') return 'All';
  if (tab === 'quarantined') return 'Blocked by scan';
  return STATUS_STYLE[tab].label;
}

/** How many documents a tab holds, from the dashboard counts. */
export function tabCount(tab: StatusTab, counts: DocumentCounts): number {
  const available = counts.public + counts.governing + counts.private;
  if (tab === 'all') return available + counts.scanning + counts.quarantined + counts.archived;
  if (tab === 'available') return available;
  return counts[tab];
}

export interface MyDocumentRow {
  doc: DocumentSummary;
  href: string;
  canEdit: boolean;
  canArchive: boolean;
  canRestore: boolean;
  /** Officers of the organization only; admins can see but not change who sees it. */
  canChangeVisibility: boolean;
}

export interface DocumentActions {
  archive: (id: string) => Promise<string | undefined>;
  restore: (id: string) => Promise<string | undefined>;
  /** Saves only what changed; resolves with an error message, if any. */
  save: (doc: DocumentSummary, values: DocumentMetadata) => Promise<string | undefined>;
  setVisibility: (id: string, visibility: DocumentVisibility) => Promise<string | undefined>;
  /** Which document an action is running on, to disable its buttons. */
  pendingId: string | null;
}

export type MyDocumentsModel =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'no-organization' }
  | {
      status: 'ready';
      organizations: OrgRef[];
      org: OrgRef;
      selectOrganization: (id: string) => void;
      canManage: boolean;
      tab: StatusTab;
      tabs: { tab: StatusTab; label: string; count: number; href: string }[];
      /** Set when a dashboard tile narrowed the list to one visibility. */
      visibilityFilter: { label: string; clearHref: string } | null;
      searchInput: string;
      setSearchInput: (value: string) => void;
      query: string;
      list:
        | { status: 'loading' }
        | { status: 'error'; retry: () => void }
        | {
            status: 'ready';
            rows: MyDocumentRow[];
            hasMore: boolean;
            loadMore: () => void;
            loadingMore: boolean;
          };
      types: DocumentType[];
      /** Choices for the edit form; a document's own year is always included. */
      yearsFor: (doc: DocumentSummary) => FilterOption[];
      semesters: FilterOption[];
      actions: DocumentActions;
    };

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && (error.status === 0 || error.status < 500)) return error.message;
  return 'Something went wrong on our side. Try again in a moment.';
}

/**
 * The details the edit form changed, as a PATCH body. Null when nothing changed. Who can
 * see the document is saved separately (PATCH /documents/:id/visibility).
 */
export function patchFor(
  doc: DocumentSummary,
  values: DocumentMetadata,
): UpdateDocumentRequest | null {
  const patch: Record<string, unknown> = {};
  const description = values.description?.trim() || null;
  const tags = values.tags ?? [];
  if (values.title.trim() !== doc.title) patch.title = values.title.trim();
  if (values.typeId !== doc.type.id) patch.typeId = values.typeId;
  if (values.academicYear !== doc.academicYear) patch.academicYear = values.academicYear;
  if ((values.semester ?? null) !== doc.semester) patch.semester = values.semester ?? null;
  if (description !== doc.description) patch.description = description;
  if (tags.join('\n') !== doc.tags.join('\n')) patch.tags = tags;
  return Object.keys(patch).length ? patch : null;
}

/**
 * /dashboard/documents: every document of an organization the user may see, by lifecycle
 * state. Organization, tab, visibility filter and search live in the URL so links and the
 * back button work; officers edit details, change who can see a document, archive and
 * restore.
 */
export function useMyDocuments(): MyDocumentsModel {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const statusParam = documentStatusSchema.safeParse(params.get('status'));
  const tab: StatusTab = statusParam.success ? statusParam.data : 'all';
  const visibilityParam = documentVisibilitySchema.safeParse(params.get('visibility'));
  const visibility = visibilityParam.success ? visibilityParam.data : undefined;
  const query = params.get('q') ?? '';
  const [searchInput, setSearchInput] = useState(query);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const visibilityChange = useSetVisibility();

  const dashboard = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => api.get('/me/dashboard', { schema: dashboardResponseSchema }),
    staleTime: 60_000,
  });
  const organizations = dashboard.data?.organizations.map((o) => o.organization) ?? [];
  const org = organizations.find((o) => o.slug === params.get('org')) ?? organizations[0];

  const types = useQuery({
    queryKey: queryKeys.documents.types,
    queryFn: () => api.get('/document-types', { schema: documentTypeListResponseSchema }),
    staleTime: 10 * 60_000,
  });

  const filters = { status: tab === 'all' ? undefined : tab, visibility, q: query || undefined };
  const list = useInfiniteQuery({
    queryKey: queryKeys.documents.mine(org?.slug ?? '', filters),
    enabled: !!org,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (filters.status) search.set('status', filters.status);
      if (filters.visibility) search.set('visibility', filters.visibility);
      if (filters.q) search.set('q', filters.q);
      if (pageParam) search.set('cursor', pageParam);
      return api.get(`/organizations/${org!.slug}/documents?${search.toString()}`, {
        schema: documentListResponseSchema,
      });
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 60_000,
  });

  // The search box updates the URL after a short pause, not on every keystroke.
  useEffect(() => {
    if (searchInput.trim() === query) return;
    const timer = setTimeout(() => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (searchInput.trim()) next.set('q', searchInput.trim());
          else next.delete('q');
          return next;
        },
        { replace: true },
      );
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchInput, query, setParams]);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['documents'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
    ]);

  const transition = useMutation({
    mutationFn: ({ id, to }: { id: string; to: 'archive' | 'restore' }) =>
      api.post(`/documents/${id}/${to}`, undefined, { schema: documentSummarySchema }),
    onSettled: refresh,
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateDocumentRequest }) =>
      api.patch(`/documents/${id}`, patch, { schema: documentSummarySchema }),
    onSettled: refresh,
  });

  async function run(
    id: string,
    action: () => Promise<unknown>,
    success: string,
  ): Promise<string | undefined> {
    setPendingId(id);
    try {
      await action();
      toast.success(success);
      return undefined;
    } catch (error) {
      return errorMessage(error);
    } finally {
      setPendingId(null);
    }
  }

  if (dashboard.isPending) return { status: 'loading' };
  if (dashboard.isError) return { status: 'error', retry: () => void dashboard.refetch() };
  if (!org) return { status: 'no-organization' };

  const data = dashboard.data;
  const counts = data.organizations.find((o) => o.organization.id === org.id)!.counts;
  // Only the organization's own account manages its documents (and it alone lists them here).
  const isOfficer = data.organizations.some((o) => o.organization.id === org.id);
  const canManage = isOfficer;

  const hrefFor = (next: StatusTab, keepVisibility = true) => {
    const search = new URLSearchParams({ org: org.slug });
    if (next !== 'all') search.set('status', next);
    if (keepVisibility && visibility) search.set('visibility', visibility);
    if (query) search.set('q', query);
    return `?${search.toString()}`;
  };

  return {
    status: 'ready',
    organizations,
    org,
    selectOrganization: (id) => {
      const next = organizations.find((o) => o.id === id);
      if (next) setParams(new URLSearchParams({ org: next.slug }));
    },
    canManage,
    tab,
    tabs: STATUS_TABS.map((t) => ({
      tab: t,
      label: tabLabel(t),
      count: tabCount(t, counts),
      href: hrefFor(t),
    })),
    visibilityFilter: visibility
      ? { label: VISIBILITY_LABEL[visibility], clearHref: hrefFor(tab, false) }
      : null,
    searchInput,
    setSearchInput,
    query,
    list: list.isPending
      ? { status: 'loading' }
      : list.isError
        ? { status: 'error', retry: () => void list.refetch() }
        : {
            status: 'ready',
            rows: list.data.pages
              .flatMap((page) => page.items)
              .map((doc) => ({
                doc,
                href: `/documents/${doc.id}`,
                canEdit: canManage && doc.status !== 'archived',
                canArchive: canManage && doc.status === 'available',
                canRestore: canManage && doc.status === 'archived',
                canChangeVisibility: isOfficer,
              })),
            hasMore: list.hasNextPage,
            loadMore: () => void list.fetchNextPage(),
            loadingMore: list.isFetchingNextPage,
          },
    types: types.data?.types ?? [],
    yearsFor: (doc) => {
      const years = yearOptions(new Date());
      return years.some((y) => y.value === doc.academicYear)
        ? years
        : [...years, { value: doc.academicYear, label: doc.academicYear }];
    },
    semesters: (Object.keys(SEMESTER_LABELS) as (keyof typeof SEMESTER_LABELS)[]).map((s) => ({
      value: s,
      label: SEMESTER_LABELS[s],
    })),
    actions: {
      pendingId: pendingId ?? visibilityChange.pendingId,
      setVisibility: visibilityChange.change,
      archive: (id) =>
        run(
          id,
          () => transition.mutateAsync({ id, to: 'archive' }),
          'Archived. Only your organization sees it now; restore it from the Archived tab.',
        ),
      restore: (id) =>
        run(
          id,
          () => transition.mutateAsync({ id, to: 'restore' }),
          'Restored. It is back in the Paperworks for whoever can see it.',
        ),
      save: (doc, values) => {
        const patch = patchFor(doc, values);
        if (!patch) return Promise.resolve(undefined);
        return run(doc.id, () => update.mutateAsync({ id: doc.id, patch }), 'Changes saved.');
      },
    },
  };
}
