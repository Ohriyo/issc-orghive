import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  NOTIFICATION_KIND_GROUPS,
  NOTIFICATION_KIND_INFO,
  notificationPreferencesSchema,
  type NotificationKind,
  type NotificationPreferences,
} from '@orghive/shared';
import { useAuth } from '@/features/auth/presenters/use-auth';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export interface SettingRow {
  kind: NotificationKind;
  label: string;
  hint: string;
  email: boolean;
  toggle: (email: boolean) => void;
}

export type NotificationSettingsModel =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | {
      status: 'ready';
      /** Where the emails go. */
      email: string | null;
      groups: { title: string; rows: SettingRow[] }[];
    };

/** Only the ISSC account receives temporary passwords to hand over. */
const ISSC_ONLY: NotificationKind[] = ['password_reveal'];

/** Pure: the settings page's groups, in the shared order; ISSC-only kinds for the ISSC. */
export function toGroups(
  preferences: NotificationPreferences,
  toggle: (kind: NotificationKind, email: boolean) => void,
  { isIssc = false }: { isIssc?: boolean } = {},
): { title: string; rows: SettingRow[] }[] {
  return NOTIFICATION_KIND_GROUPS.map((group) => ({
    ...group,
    kinds: group.kinds.filter((kind) => isIssc || !ISSC_ONLY.includes(kind)),
  }))
    .filter((group) => group.kinds.length > 0)
    .map((group) => ({
      title: group.title,
      rows: group.kinds.map((kind) => ({
        kind,
        ...NOTIFICATION_KIND_INFO[kind],
        email: preferences.email[kind],
        toggle: (email: boolean) => toggle(kind, email),
      })),
    }));
}

/**
 * /dashboard/notifications/settings: email on or off per kind. Each switch saves at once
 * (optimistic: it flips straight away and flips back if the save fails).
 */
export function useNotificationSettings(): NotificationSettingsModel {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const key = queryKeys.notificationPreferences;

  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get('/me/notification-preferences', { schema: notificationPreferencesSchema }),
    staleTime: 5 * 60_000,
  });
  const save = useMutation({
    mutationFn: ({ kind, email }: { kind: NotificationKind; email: boolean }) =>
      api.put(
        '/me/notification-preferences',
        { email: { [kind]: email } },
        { schema: notificationPreferencesSchema },
      ),
    onMutate: async ({ kind, email }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<NotificationPreferences>(key);
      if (before) {
        queryClient.setQueryData<NotificationPreferences>(key, {
          email: { ...before.email, [kind]: email },
        });
      }
      return { before };
    },
    onSuccess: (saved, { kind, email }) => {
      queryClient.setQueryData(key, saved);
      const label = NOTIFICATION_KIND_INFO[kind].label;
      toast.success(email ? `${label} will be emailed.` : `${label}: no more emails.`);
    },
    onError: (error, _input, context) => {
      if (context?.before) queryClient.setQueryData(key, context.before);
      toast.error(
        error instanceof ApiError && error.status > 0 && error.status < 500
          ? error.message
          : 'The setting was not saved. Try again.',
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  if (!query.data) return { status: 'loading' };
  return {
    status: 'ready',
    email: user?.email ?? null,
    groups: toGroups(query.data, (kind, email) => save.mutate({ kind, email }), {
      isIssc: user?.organization?.type === 'ISSC',
    }),
  };
}
