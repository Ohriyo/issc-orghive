import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  announcementSchema,
  type CreateAnnouncementRequest,
  type UpdateAnnouncementRequest,
} from '@orghive/shared';
import { useAuth } from '@/features/auth/presenters/use-auth';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { toUpdateItem, type UpdateItem } from './update-format';
import { messageOf } from './use-updates';

export type UpdateModel =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; retry: () => void }
  | {
      status: 'ready';
      item: UpdateItem;
      /** For the posting council's officers; null for everyone else. */
      editor: {
        open: boolean;
        setOpen: (open: boolean) => void;
        save: (values: CreateAnnouncementRequest) => Promise<string | null>;
      } | null;
      remover: {
        confirming: boolean;
        ask: () => void;
        cancel: () => void;
        /** Resolves true once deleted; the page then leaves. */
        confirm: () => Promise<boolean>;
        deleting: boolean;
      } | null;
    };

/** Only what changed is sent; null when nothing did. */
export function changesOf(
  before: { title: string; body: string },
  after: CreateAnnouncementRequest,
): UpdateAnnouncementRequest | null {
  const patch: UpdateAnnouncementRequest = {};
  if (after.title !== before.title) patch.title = after.title;
  if (after.body !== before.body) patch.body = after.body;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** /updates/:id: one update; its council's officers can edit or delete it. */
export function useUpdate(id: string): UpdateModel {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const viewer = user?.id ?? 'anonymous';
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const query = useQuery({
    queryKey: queryKeys.announcements.detail(id, viewer),
    queryFn: () => api.get(`/announcements/${id}`, { schema: announcementSchema }),
    staleTime: 60_000,
    // Only a lost connection or a server error can go better on a retry.
    retry: (count, error) =>
      error instanceof ApiError && (error.status === 0 || error.status >= 500) && count < 2,
  });

  if (query.isError) {
    const error = query.error;
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
      return { status: 'not-found' };
    }
    return { status: 'error', retry: () => void query.refetch() };
  }
  if (!query.data) return { status: 'loading' };
  const item = toUpdateItem(query.data);

  return {
    status: 'ready',
    item,
    editor: item.canEdit
      ? {
          open,
          setOpen,
          save: async (values) => {
            const patch = changesOf(item.draft, values);
            if (!patch) {
              setOpen(false);
              return null;
            }
            try {
              await api.patch(`/announcements/${id}`, patch, { schema: announcementSchema });
              await queryClient.invalidateQueries({ queryKey: queryKeys.announcements.all });
              setOpen(false);
              return null;
            } catch (error) {
              return messageOf(error);
            }
          },
        }
      : null,
    remover: item.canEdit
      ? {
          confirming,
          deleting,
          ask: () => setConfirming(true),
          cancel: () => setConfirming(false),
          confirm: async () => {
            setDeleting(true);
            try {
              await api.delete(`/announcements/${id}`);
              // Marked stale, not refetched: refetching this page's own query would flash
              // "not found" before the page leaves. Lists refetch when they are shown.
              await queryClient.invalidateQueries({
                queryKey: queryKeys.announcements.all,
                refetchType: 'none',
              });
              return true;
            } catch (error) {
              setConfirming(false);
              setDeleting(false);
              toast.error(messageOf(error));
              return false;
            }
          },
        }
      : null,
  };
}
