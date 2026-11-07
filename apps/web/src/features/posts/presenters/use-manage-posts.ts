import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  managedPostListResponseSchema,
  PINNED_HIGHLIGHTS_MAX,
  type ManagedPost,
  type OrgPostStatus,
} from '@orghive/shared';
import { useActingAs, type ActingAsModel } from '@/features/auth/presenters/use-acting-as';
import { useAuth } from '@/features/auth/presenters/use-auth';
import { formatManilaDate } from '@/features/projects/presenters/project-format';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { postHref } from './post-format';

const STATUS_LABEL: Record<OrgPostStatus, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  PUBLISHED: 'Published',
  HIDDEN: 'Hidden',
};

export interface ManagedPostRow {
  id: string;
  title: string;
  kind: string;
  status: OrgPostStatus;
  statusLabel: string;
  /** "Published Nov 5, 2026", "Goes live Nov 8, 2026", "Hidden: <reason>", "Saved Nov 4". */
  detail: string;
  editHref: string;
  /** The public page, once anyone else can see it. */
  viewHref: string;
  canPublish: boolean;
  canUnpublish: boolean;
}

export interface PinnedRow {
  id: string;
  title: string;
  place: number;
}

export interface ManagePostsModel {
  org: { slug: string; acronym: string };
  actingAs: ActingAsModel;
  tabs: { label: string; href: string; current: boolean }[];
  rows: ManagedPostRow[];
  emptyText: string;
  pinned: PinnedRow[];
  /** Live or scheduled highlights not on the carousel yet. */
  pinnable: { id: string; title: string }[];
  canPinMore: boolean;
  busy: boolean;
  publish: (id: string) => void;
  unpublish: (id: string) => void;
  remove: (id: string) => void;
  pin: (id: string) => void;
  unpin: (id: string) => void;
  move: (id: string, by: -1 | 1) => void;
}

export type ManagePostsState =
  | { status: 'loading' }
  | { status: 'no-organization' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; model: ManagePostsModel };

const TABS: [string, OrgPostStatus | undefined][] = [
  ['All', undefined],
  ['Drafts', 'DRAFT'],
  ['Scheduled', 'SCHEDULED'],
  ['Published', 'PUBLISHED'],
  ['Hidden', 'HIDDEN'],
];

export function toRow(orgSlug: string, post: ManagedPost): ManagedPostRow {
  const detail =
    post.status === 'HIDDEN' && post.moderation
      ? `Hidden by a governing body: ${post.moderation.reason}`
      : post.status === 'SCHEDULED' && post.publishAt
        ? `Goes live ${formatManilaDate(post.publishAt)}`
        : post.status === 'PUBLISHED' && post.publishedAt
          ? `Published ${formatManilaDate(post.publishedAt)}`
          : `Saved ${formatManilaDate(post.updatedAt)}`;
  return {
    id: post.id,
    title: post.title,
    kind: post.type === 'HIGHLIGHT' ? 'Highlight' : 'Update',
    status: post.status,
    statusLabel: STATUS_LABEL[post.status],
    detail,
    editHref: `/dashboard/posts/${post.id}`,
    viewHref: postHref(orgSlug, post.slug),
    canPublish: post.status === 'DRAFT' || post.status === 'HIDDEN',
    canUnpublish: post.status === 'PUBLISHED' || post.status === 'SCHEDULED',
  };
}

/**
 * Presenter for /dashboard/posts: the organization's own updates and highlights in every
 * state, the one-click actions (each names who is acting), and the carousel's pins: up to
 * six live highlights, in order.
 */
export function useManagePosts(): ManagePostsState {
  const { user } = useAuth();
  const org = user?.organization ?? null;
  const slug = org?.slug ?? '';
  const [params] = useSearchParams();
  const statusParam = params.get('status');
  const status = TABS.find(([, s]) => s === statusParam)?.[1];
  const queryClient = useQueryClient();
  const actingAs = useActingAs();

  const list = useQuery({
    queryKey: queryKeys.posts.manage(slug, { status: status ?? 'ALL' }),
    queryFn: () =>
      api.get(`/organizations/${slug}/manage/posts${status ? `?status=${status}` : ''}`, {
        schema: managedPostListResponseSchema,
      }),
    enabled: Boolean(org),
  });
  const highlights = useQuery({
    queryKey: queryKeys.posts.manage(slug, { type: 'highlight' }),
    queryFn: () =>
      api.get(`/organizations/${slug}/manage/posts?type=highlight`, {
        schema: managedPostListResponseSchema,
      }),
    enabled: Boolean(org),
  });

  const action = useMutation({
    mutationFn: async (run: () => Promise<unknown>) => run(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.posts.all }),
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'That did not work. Try again.'),
  });

  if (!org) return { status: 'no-organization' };
  if (list.isError || highlights.isError) {
    return {
      status: 'error',
      retry: () => {
        void list.refetch();
        void highlights.refetch();
      },
    };
  }
  if (!list.data || !highlights.data) return { status: 'loading' };

  const pinnedPosts = highlights.data.items
    .filter((p) => p.pinned)
    .sort((a, b) => (a.pinOrder ?? 0) - (b.pinOrder ?? 0));
  const pinnedIds = pinnedPosts.map((p) => p.id);

  /** Runs `request` after checking "Acting as", then says `done`. */
  const act = (done: string, request: (name: string) => Promise<unknown>) => {
    const name = actingAs.take();
    if (!name) return;
    action.mutate(async () => {
      await request(name);
      toast.success(done);
    });
  };
  const setPins = (ids: string[], done: string) =>
    act(done, (name) =>
      api.put(`/organizations/${slug}/highlights/pinned`, { actingAs: name, postIds: ids }),
    );

  return {
    status: 'ready',
    model: {
      org: { slug: org.slug, acronym: org.acronym },
      actingAs,
      tabs: TABS.map(([label, s]) => ({
        label,
        href: s ? `/dashboard/posts?status=${s}` : '/dashboard/posts',
        current: s === status,
      })),
      rows: list.data.items.map((p) => toRow(org.slug, p)),
      emptyText: status
        ? `No ${STATUS_LABEL[status].toLowerCase()} posts.`
        : `${org.acronym} has no posts yet. Write an update or a highlight to show on your page.`,
      pinned: pinnedPosts.map((p, i) => ({ id: p.id, title: p.title, place: i + 1 })),
      pinnable: highlights.data.items
        .filter((p) => !p.pinned && (p.status === 'PUBLISHED' || p.status === 'SCHEDULED'))
        .map((p) => ({ id: p.id, title: p.title })),
      canPinMore: pinnedIds.length < PINNED_HIGHLIGHTS_MAX,
      busy: action.isPending,
      publish: (id) =>
        act('Published.', (name) =>
          api.post(`/organizations/${slug}/posts/${id}/publish`, { actingAs: name }),
        ),
      unpublish: (id) =>
        act('Unpublished: it is a draft again.', (name) =>
          api.post(`/organizations/${slug}/posts/${id}/unpublish`, { actingAs: name }),
        ),
      remove: (id) =>
        act('Deleted.', (name) =>
          api.delete(`/organizations/${slug}/posts/${id}`, { json: { actingAs: name } }),
        ),
      pin: (id) => setPins([...pinnedIds, id], 'Pinned to the carousel.'),
      unpin: (id) =>
        setPins(
          pinnedIds.filter((x) => x !== id),
          'Removed from the carousel.',
        ),
      move: (id, by) => {
        const ids = [...pinnedIds];
        const from = ids.indexOf(id);
        const to = from + by;
        if (from < 0 || to < 0 || to >= ids.length) return;
        [ids[from], ids[to]] = [ids[to]!, ids[from]!];
        setPins(ids, 'Carousel order saved.');
      },
    },
  };
}
