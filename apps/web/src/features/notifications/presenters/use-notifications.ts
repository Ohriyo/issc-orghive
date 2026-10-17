import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { notificationListResponseSchema, type Notification } from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "5 minutes ago", "yesterday". */
export function timeAgo(iso: string, now: Date): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return 'just now';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86_400), 'day');
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  unread: boolean;
  when: string;
  open: () => void;
}

export type NotificationsModel =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | {
      status: 'ready';
      unreadCount: number;
      items: NotificationItem[];
      markAllRead: () => void;
    };

/**
 * The header bell: the signed-in user's latest notifications (deadlines, blocks, freezes,
 * appeals). Checks again every minute; opening one marks it read and goes to its page.
 */
export function useNotifications(
  signedIn: boolean,
  now: () => Date = () => new Date(),
): NotificationsModel {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: () => api.get('/me/notifications', { schema: notificationListResponseSchema }),
    enabled: signedIn,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/me/notifications/${id}/read`),
    onSettled: invalidate,
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/me/notifications/read-all'),
    onSettled: invalidate,
  });

  if (!signedIn) return { status: 'off' };
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  if (!query.data) return { status: 'loading' };
  const at = now();
  return {
    status: 'ready',
    unreadCount: query.data.unreadCount,
    items: query.data.items.map((n: Notification) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      unread: n.readAt === null,
      when: timeAgo(n.createdAt, at),
      open: () => {
        if (n.readAt === null) markRead.mutate(n.id);
        if (n.link) void navigate(n.link);
      },
    })),
    markAllRead: () => markAll.mutate(),
  };
}
