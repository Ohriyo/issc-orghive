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
  type DocumentMetadata,
  type DocumentStatus,
  type DocumentSummary,
  type DocumentType,
  type UpdateDocumentRequest,
} from '@orghive/shared';
import { STATUS_STYLE } from '@/components/status-style';
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

/** Content may change only before review (docs/DOMAIN_RULES.md); visibility until archived. */
const CONTENT_EDITABLE: DocumentStatus[] = ['draft', 'rejected'];
const ARCHIVABLE: DocumentStatus[] = ['approved', 'rejected'];

export type StatusTab = DocumentStatus | 'all';
export const STATUS_TABS: StatusTab[] = [
  'all',
  'draft',
  'pending',
  'approved',
  'rejected',
  'archived',
];

export function tabLabel(tab: StatusTab): string {
  if (tab === 'all') return 'All';
  if (tab === 'draft') return 'Drafts';
  if (tab === 'rejected') return 'Needs revision';
  return STATUS_STYLE[tab].label;
}

export interface MyDocumentRow {
  doc: DocumentSummary;
  href: string;
  /** Title, type, year, semester, description and tags: only while draft or rejected. */
  contentEditable: boolean;
  canEdit: boolean;
  canArchive: boolean;
  canRestore: boolean;
}

export interface DocumentActions {
  archive: (id: string) => Promise<string | undefined>;
  restore: (id: string) => Promise<string | undefined>;
  /** Saves only what changed; resolves with an error message, if any. */
  save: (doc: DocumentSummary, values: DocumentMetadata) => Promise<string | undefined>;
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

/** The fields the edit form changed, as a PATCH body. Null when nothing changed. */
export function patchFor(
  doc: DocumentSummary,
  values: DocumentMetadata,
): UpdateDocumentRequest | null {
  if (!CONTENT_EDITABLE.includes(doc.status)) {
    return values.visibility && values.visibility !== doc.visibility
      ? { visibility: values.visibility }
      : null;
  }
  const patch: Record<string, unknown> = {};
  const description = values.description?.trim() || null;
  const tags = values.tags ?? [];
  if (values.title.trim() !== doc.title) patch.title = values.title.trim();
  if (values.typeId !== doc.type.id) patch.typeId = values.typeId;
  if (values.academicYear !== doc.academicYear) patch.academicYear = values.academicYear;
  if ((values.semester ?? null) !== doc.semester) patch.semester = values.semester ?? null;
  if (description !== doc.description) patch.description = description;
  if (values.visibility && values.visibility !== doc.visibility)
    patch.visibility = values.visibility;
  if (tags.join('\n') !== doc.tags.join('\n')) patch.tags = tags;
  return Object.keys(patch).length ? patch : null;
}

/**
 * /dashboard/documents: an organization's full list for its members, drafts, pending and
 * rejected included. Organization, tab and search live in the URL so links and the back
 * button work; officers edit details, archive and restore.
 */
export function useMyDocuments(): MyDocumentsModel {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const statusParam = documentStatusSchema.safeParse(params.get('status'));
  const tab: StatusTab = statusParam.success ? statusParam.data : 'all';
  const query = params.get('q') ?? '';
  const [searchInput, setSearchInput] = useState(query);
  const [pendingId, setPendingId] = useState<string | null>(null);

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

  const filters = { status: tab === 'all' ? undefined : tab, q: query || undefined };
  const list = useInfiniteQuery({
    queryKey: queryKeys.documents.mine(org?.slug ?? '', filters),
    enabled: !!org,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (filters.status) search.set('status', filters.status);
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
  const canManage =
    data.isAdmin ||
    data.memberships.some((m) => m.organizationId === org.id && m.role === 'officer');

  const hrefFor = (next: StatusTab) => {
    const search = new URLSearchParams({ org: org.slug });
    if (next !== 'all') search.set('status', next);
    if (query) search.set('q', query);
    return `?${search.toString()}`;
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

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
      count: t === 'all' ? total : counts[t],
      href: hrefFor(t),
    })),
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
                contentEditable: CONTENT_EDITABLE.includes(doc.status),
                canEdit: canManage && doc.status !== 'archived',
                canArchive: canManage && ARCHIVABLE.includes(doc.status),
                canRestore: canManage && doc.status === 'archived',
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
      pendingId,
      archive: (id) =>
        run(
          id,
          () => transition.mutateAsync({ id, to: 'archive' }),
          'Archived. It is no longer in the public Paperworks; restore it from the Archived tab.',
        ),
      restore: (id) =>
        run(
          id,
          () => transition.mutateAsync({ id, to: 'restore' }),
          'Restored to the status it had before.',
        ),
      save: (doc, values) => {
        const patch = patchFor(doc, values);
        if (!patch) return Promise.resolve(undefined);
        return run(doc.id, () => update.mutateAsync({ id: doc.id, patch }), 'Changes saved.');
      },
    },
  };
}
