import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { systemUserListResponseSchema, systemUserSchema, type SystemUser } from '@orghive/shared';
import { useAuth } from '@/features/auth/presenters/use-auth';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatDate, messageOf, toSearch } from './system-format';
import { useStepUp } from './use-step-up';

export type UserActionKind = 'deactivate' | 'reactivate' | 'demote';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  isSelf: boolean;
  role: 'Super admin' | 'User';
  /** Super admins only: "MFA on since Oct 19, 2026", or pending setup. */
  mfa: { label: string; pending: boolean } | null;
  status: 'Active' | 'Deactivated';
  /** The organization this shared account belongs to; null for super admins. */
  organization: string | null;
  actions: { kind: UserActionKind; label: string }[];
}

/** What the confirm dialog asks about; null when closed. */
export interface Confirming {
  kind: UserActionKind;
  title: string;
  body: string;
  confirmLabel: string;
  run: () => void;
}

export type StatusFilter = '' | 'active' | 'disabled';

const ACTION_LABEL: Record<UserActionKind, string> = {
  deactivate: 'Deactivate',
  reactivate: 'Reactivate',
  demote: 'Remove super admin',
};

function confirmCopy(kind: UserActionKind, user: SystemUser) {
  switch (kind) {
    case 'deactivate':
      return {
        title: `Deactivate ${user.name}?`,
        body: `${user.email} is signed out everywhere and cannot sign in until reactivated. Their documents and roles stay as they are.`,
        confirmLabel: 'Deactivate',
      };
    case 'reactivate':
      return {
        title: `Reactivate ${user.name}?`,
        body: `${user.email} can sign in again with their current password.`,
        confirmLabel: 'Reactivate',
      };
    case 'demote':
      return {
        title: `Remove ${user.name} as super admin?`,
        body: `${user.email} loses the system console, their authenticator and recovery codes are removed, and they are signed out. Making them a super admin again needs the create-super-admin command.`,
        confirmLabel: 'Remove super admin',
      };
  }
}

/**
 * /system/users and /system/super-admins: accounts, newest first, with deactivate,
 * reactivate and (for super admins) demote. Each change is confirmed, then needs a fresh
 * step-up code; the API enforces who may be changed (never yourself, never the last).
 */
export function useSystemUsers({ superAdminsOnly }: { superAdminsOnly: boolean }) {
  const queryClient = useQueryClient();
  const me = useAuth().user?.id;
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const stepUp = useStepUp();

  const filters = {
    q: submitted || undefined,
    status: status || undefined,
    role: superAdminsOnly ? 'SUPER_ADMIN' : undefined,
  };
  const list = useInfiniteQuery({
    queryKey: queryKeys.system.users(filters),
    queryFn: ({ pageParam }) =>
      api.get(`/system/users${toSearch({ ...filters, cursor: pageParam, limit: '25' })}`, {
        schema: systemUserListResponseSchema,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
  });

  const action = useMutation({
    mutationFn: ({ kind, user }: { kind: UserActionKind; user: SystemUser }) =>
      stepUp.guard(() =>
        kind === 'demote'
          ? api.patch(
              `/system/users/${user.id}/system-role`,
              { systemRole: 'NONE' },
              { schema: systemUserSchema },
            )
          : api.patch(
              `/system/users/${user.id}/status`,
              { active: kind === 'reactivate' },
              { schema: systemUserSchema },
            ),
      ),
    onSuccess: (result, { kind, user }) => {
      if (!result) return;
      const done: Record<UserActionKind, string> = {
        deactivate: `${user.name} is deactivated`,
        reactivate: `${user.name} is active again`,
        demote: `${user.name} is no longer a super admin`,
      };
      toast.success(done[kind]);
    },
    onError: (error) => toast.error(messageOf(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.system.all }),
  });

  const ask = (kind: UserActionKind, user: SystemUser) =>
    setConfirming({
      kind,
      ...confirmCopy(kind, user),
      run: () => {
        setConfirming(null);
        action.mutate({ kind, user });
      },
    });

  const toRow = (user: SystemUser): UserRow => {
    const isSuper = user.systemRole === 'SUPER_ADMIN';
    const kinds: UserActionKind[] = [];
    if (user.disabledAt) kinds.push('reactivate');
    else if (user.id !== me) kinds.push('deactivate');
    if (isSuper && superAdminsOnly) kinds.push('demote');
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      isSelf: user.id === me,
      role: isSuper ? 'Super admin' : 'User',
      mfa: isSuper
        ? user.mfaEnabledAt
          ? { label: `MFA on since ${formatDate(user.mfaEnabledAt)}`, pending: false }
          : { label: 'MFA pending', pending: true }
        : null,
      status: user.disabledAt ? 'Deactivated' : 'Active',
      organization: user.organization?.acronym ?? null,
      actions: kinds.map((kind) => ({ kind, label: ACTION_LABEL[kind] })),
    };
  };

  const users = list.data?.pages.flatMap((page) => page.items) ?? [];
  const byId = new Map(users.map((user) => [user.id, user]));

  return {
    filters: {
      query,
      setQuery,
      status,
      setStatus,
      search: () => setSubmitted(query.trim()),
    },
    list: list.isPending
      ? ({ status: 'loading' } as const)
      : list.isError
        ? ({ status: 'error', retry: () => void list.refetch() } as const)
        : ({
            status: 'ready',
            rows: users.map(toRow),
            hasMore: list.hasNextPage,
            loadMore: () => void list.fetchNextPage(),
            isLoadingMore: list.isFetchingNextPage,
          } as const),
    act: (kind: UserActionKind, userId: string) => {
      const user = byId.get(userId);
      if (user) ask(kind, user);
    },
    pendingId: action.isPending ? action.variables.user.id : null,
    confirming,
    cancelConfirm: () => setConfirming(null),
    stepUp: stepUp.dialog,
  };
}

export type SystemUsersModel = ReturnType<typeof useSystemUsers>;
