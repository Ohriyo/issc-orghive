import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import {
  NOTIFICATION_KIND_INFO,
  notificationListResponseSchema,
  type Notification,
  type NotificationListResponse,
} from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useOriginNavigate } from '@/navigation/use-origin-navigate';
import { timeAgo } from './use-notifications';
import { useReveal, type RevealState } from './use-reveal';

const PAGE_SIZE = 20;

export type NotificationShow = 'all' | 'unread';

const exactTime = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Manila',
});

/** One notification on the center page. */
export interface CenterItem {
  id: string;
  title: string;
  body: string;
  /** "Deadline reminders": what kind it is, as on the email settings page. */
  kindLabel: string;
  unread: boolean;
  /** "3 hours ago". */
  when: string;
  /** "Oct 18, 2026, 2:05 PM", for the <time> element's title. */
  at: string;
  createdAt: string;
  /** Null when it has no page to open. */
  href: string | null;
  /** Marks it read and opens its page. */
  open: () => void;
  markRead: () => void;
  /** Opens its one-time Reveal of temporary passwords; null when it has none. */
  openReveal: (() => void) | null;
}

export type NotificationCenterModel = {
  show: NotificationShow;
  setShow: (show: NotificationShow) => void;
  /** The open Reveal dialog (from `?reveal=`), or null. */
  reveal: RevealState | null;
  closeReveal: () => void;
} & (
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | {
      status: 'ready';
      unreadCount: number;
      items: CenterItem[];
      markAllRead: () => void;
      more: { load: () => void; loading: boolean } | null;
    }
);

/** Pure: a notification as the center lists it. */
export function toCenterItem(
  n: Notification,
  now: Date,
  actions: { open: () => void; markRead: () => void; openReveal: (() => void) | null },
): CenterItem {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    kindLabel: NOTIFICATION_KIND_INFO[n.kind].label,
    unread: n.readAt === null,
    when: timeAgo(n.createdAt, now),
    at: exactTime.format(new Date(n.createdAt)),
    createdAt: n.createdAt,
    href: n.link,
    ...actions,
  };
}

/**
 * /dashboard/notifications?show=unread: every notification, newest first, a page at a time.
 * Reading one marks it read; the bell and this page refresh together.
 */
export function useNotificationCenter(now: () => Date = () => new Date()): NotificationCenterModel {
  const queryClient = useQueryClient();
  const navigate = useOriginNavigate();
  const [params, setParams] = useSearchParams();
  const show: NotificationShow = params.get('show') === 'unread' ? 'unread' : 'all';
  const revealId = params.get('reveal');
  const { state: reveal, forget: forgetReveal } = useReveal(revealId);

  const list = useInfiniteQuery({
    queryKey: queryKeys.notificationCenter(show),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (show === 'unread') search.set('unread', 'true');
      if (pageParam) search.set('cursor', pageParam);
      return api.get(`/me/notifications?${search.toString()}`, {
        schema: notificationListResponseSchema,
      });
    },
    getNextPageParam: (last: NotificationListResponse) => last.nextCursor ?? undefined,
    staleTime: 30_000,
  });
  // The bell's query is a prefix of this page's, so one invalidation refreshes both.
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/me/notifications/${id}/read`),
    onSettled: refresh,
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/me/notifications/read-all'),
    onSettled: refresh,
  });

  const withParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };
  const base = {
    show,
    setShow: (next: NotificationShow) => withParam('show', next === 'all' ? null : next),
    reveal,
    closeReveal: () => {
      forgetReveal();
      withParam('reveal', null);
    },
  };
  if (list.isError) return { ...base, status: 'error', retry: () => void list.refetch() };
  if (!list.data) return { ...base, status: 'loading' };

  const at = now();
  return {
    ...base,
    status: 'ready',
    unreadCount: list.data.pages[0]?.unreadCount ?? 0,
    items: list.data.pages.flatMap((page) =>
      page.items.map((n) =>
        toCenterItem(n, at, {
          open: () => {
            if (n.readAt === null) markRead.mutate(n.id);
            // Back from the page it opens returns here.
            if (n.link) navigate(n.link);
          },
          markRead: () => markRead.mutate(n.id),
          openReveal: n.revealId
            ? () => {
                if (n.readAt === null) markRead.mutate(n.id);
                withParam('reveal', n.revealId);
              }
            : null,
        }),
      ),
    ),
    markAllRead: () => markAll.mutate(),
    more: list.hasNextPage
      ? { load: () => void list.fetchNextPage(), loading: list.isFetchingNextPage }
      : null,
  };
}
