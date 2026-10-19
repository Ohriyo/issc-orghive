import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  systemUserListResponseSchema,
  systemUserSchema,
  type AccountStatus,
  type LastLoginFilter,
  type OrganizationType,
  type SystemUser,
} from '@orghive/shared';
import { useAuth } from '@/features/auth/presenters/use-auth';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatDate, formatDateTime, messageOf, toSearch } from './system-format';
import { useStepUp } from './use-step-up';

export type UserActionKind = 'deactivate' | 'reactivate' | 'demote';

/** How an account stands, in one word: what the list shows and filters by. */
export type AccountStanding = 'Active' | 'Locked' | 'Deactivated' | 'Must change password';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  href: string;
  isSelf: boolean;
  role: 'Super admin' | 'Organization';
  /** Super admins only: "MFA on since Oct 19, 2026", or pending setup. */
  mfa: { label: string; pending: boolean } | null;
  standing: AccountStanding;
  /** "JPICE · CEA"; null for super admins. */
  organization: string | null;
  /** "Rosa Lim, President". */
  officer: string | null;
  lastLogin: string;
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

export const STATUS_OPTIONS: { value: AccountStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'locked', label: 'Locked' },
  { value: 'deactivated', label: 'Deactivated' },
  { value: 'must_change', label: 'Must change password' },
];
export const TYPE_OPTIONS: { value: OrganizationType; label: string }[] = [
  { value: 'ISSC', label: 'ISSC' },
  { value: 'CSC', label: 'CSC' },
  { value: 'SBO', label: 'SBO' },
];
export const LAST_LOGIN_OPTIONS: { value: LastLoginFilter; label: string }[] = [
  { value: 'never', label: 'Never signed in' },
  { value: '7d', label: 'In the last 7 days' },
  { value: '30d', label: 'In the last 30 days' },
  { value: 'older', label: 'Over 30 days ago' },
];

const ACTION_LABEL: Record<UserActionKind, string> = {
  deactivate: 'Deactivate',
  reactivate: 'Reactivate',
  demote: 'Remove super admin',
};

export function standingOf(user: SystemUser): AccountStanding {
  if (user.disabledAt) return 'Deactivated';
  if (user.lockedAt) return 'Locked';
  if (user.mustChangePassword) return 'Must change password';
  return 'Active';
}

function confirmCopy(kind: UserActionKind, user: SystemUser) {
  switch (kind) {
    case 'deactivate':
      return {
        title: `Deactivate ${user.name}?`,
        body: `${user.email} is signed out everywhere and cannot sign in until reactivated.`,
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
 * /system/users (organization accounts, each opening its account page) and
 * /system/super-admins (with deactivate, reactivate and demote). Numbered pages; each change
 * is confirmed, then needs a fresh step-up code. The API enforces who may be changed.
 */
export function useSystemUsers({ superAdminsOnly }: { superAdminsOnly: boolean }) {
  const queryClient = useQueryClient();
  const me = useAuth().user?.id;
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [status, setStatusState] = useState<AccountStatus | ''>('');
  const [type, setTypeState] = useState<OrganizationType | ''>('');
  const [lastLogin, setLastLoginState] = useState<LastLoginFilter | ''>('');
  const [page, setPage] = useState(1);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const stepUp = useStepUp();

  // A new filter starts again at page 1.
  const filtered =
    <T>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };

  const filters = {
    q: submitted || undefined,
    status: status || undefined,
    type: type || undefined,
    lastLogin: lastLogin || undefined,
    role: superAdminsOnly ? 'SUPER_ADMIN' : undefined,
    page: String(page),
  };
  const list = useQuery({
    queryKey: queryKeys.system.users(filters),
    queryFn: () =>
      api.get(`/system/users${toSearch(filters)}`, { schema: systemUserListResponseSchema }),
    placeholderData: keepPreviousData,
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
    if (superAdminsOnly) {
      if (user.disabledAt) kinds.push('reactivate');
      else if (user.id !== me) kinds.push('deactivate');
      if (isSuper) kinds.push('demote');
    }
    const org = user.organization;
    const officer = user.officerInCharge;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      href: `/system/users/${user.id}`,
      isSelf: user.id === me,
      role: isSuper ? 'Super admin' : 'Organization',
      mfa: isSuper
        ? user.mfaEnabledAt
          ? { label: `MFA on since ${formatDate(user.mfaEnabledAt)}`, pending: false }
          : { label: 'MFA pending', pending: true }
        : null,
      standing: standingOf(user),
      organization: org ? [org.acronym, org.college].filter(Boolean).join(' · ') : null,
      officer: officer ? `${officer.name}, ${officer.position}` : null,
      lastLogin: user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never',
      actions: kinds.map((kind) => ({ kind, label: ACTION_LABEL[kind] })),
    };
  };

  const data = list.data;
  const byId = new Map((data?.items ?? []).map((user) => [user.id, user]));
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return {
    filters: {
      query,
      setQuery,
      status,
      setStatus: filtered(setStatusState),
      type,
      setType: filtered(setTypeState),
      lastLogin,
      setLastLogin: filtered(setLastLoginState),
      search: () => {
        setSubmitted(query.trim());
        setPage(1);
      },
    },
    list: list.isPending
      ? ({ status: 'loading' } as const)
      : list.isError || !data
        ? ({ status: 'error', retry: () => void list.refetch() } as const)
        : ({
            status: 'ready',
            rows: data.items.map(toRow),
            total: data.total,
            page: data.page,
            pageCount,
            isFetching: list.isFetching,
            goTo: (next: number) => setPage(Math.min(Math.max(1, next), pageCount)),
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
