import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  accountEmailSchema,
  officerInChargeInputSchema,
  passwordResetResponseSchema,
  supportDocumentListSchema,
  systemUserDetailSchema,
  systemUserSchema,
  type SupportDocument,
  type SystemUser,
  type SystemUserDetail,
} from '@orghive/shared';
import { VISIBILITY_LABEL } from '@/components/visibility';
import { useAuth } from '@/features/auth/presenters/use-auth';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { actionLabel, formatDate, formatDateTime, messageOf } from './system-format';
import { standingOf, type AccountStanding, type Confirming } from './use-system-users';
import { useStepUp } from './use-step-up';

export const editAccountFormSchema = z.object({
  email: accountEmailSchema,
  officerInCharge: officerInChargeInputSchema,
  termEnd: z.string(),
});
export type EditAccountForm = z.input<typeof editAccountFormSchema>;

const lockFormSchema = z.object({
  reason: z.string().trim().min(3, 'Say why, in a few words').max(200),
});

const sizeFormat = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 1 });
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  return bytes < 1024 * 1024
    ? `${sizeFormat.format(bytes / 1024)} KB`
    : `${sizeFormat.format(bytes / 1024 / 1024)} MB`;
}

export interface FileRow {
  id: string;
  /** "Private file" when its title is hidden. */
  title: string;
  hidden: boolean;
  type: string;
  status: string;
  visibility: string;
  size: string;
  updated: string;
  isTestData: boolean;
  stuck: boolean;
  canRescan: boolean;
  canRestore: boolean;
}

function toFileRow(doc: SupportDocument): FileRow {
  return {
    id: doc.id,
    title: doc.title ?? 'Private file',
    hidden: doc.title === null,
    type: doc.type,
    status: doc.stuck ? 'Scan stuck' : actionLabel(doc.status),
    visibility: VISIBILITY_LABEL[doc.visibility],
    size: formatBytes(doc.sizeBytes),
    updated: formatDate(doc.updatedAt),
    isTestData: doc.isTestData,
    stuck: doc.stuck,
    canRescan: doc.scanStatus === 'pending',
    canRestore: doc.status === 'archived',
  };
}

export interface AccountSummary {
  name: string;
  email: string;
  standing: AccountStanding;
  lockReason: string | null;
  isSuperAdmin: boolean;
  isSelf: boolean;
  organization: { acronym: string; name: string; type: string; college: string | null } | null;
  officer: SystemUser['officerInCharge'];
  lastLogin: string;
  created: string;
}

function summaryOf(account: SystemUser, me: string | undefined): AccountSummary {
  return {
    name: account.name,
    email: account.email,
    standing: standingOf(account),
    lockReason: account.lockReason,
    isSuperAdmin: account.systemRole === 'SUPER_ADMIN',
    isSelf: account.id === me,
    organization: account.organization && {
      acronym: account.organization.acronym,
      name: account.organization.name,
      type: account.organization.type,
      college: account.organization.college,
    },
    officer: account.officerInCharge,
    lastLogin: account.lastLoginAt ? formatDateTime(account.lastLoginAt) : 'Never',
    created: formatDate(account.createdAt),
  };
}

function historyOf(detail: SystemUserDetail) {
  return {
    terms: detail.terms.map((t) => ({
      officer: `${t.officerName}, ${t.officerPosition}`,
      email: t.officerEmail,
      span: `${formatDate(t.termStart)} – ${
        t.endedAt
          ? formatDate(t.endedAt)
          : t.termEnd
            ? `${formatDate(t.termEnd)} (planned)`
            : 'open'
      }`,
      current: t.endedAt === null,
    })),
    logins: detail.logins.map((l) => ({
      when: formatDateTime(l.at),
      result: l.succeeded ? 'Signed in' : 'Failed',
      from: [l.ip, l.userAgent].filter(Boolean).join(' · ') || '—',
    })),
    sessions: detail.sessions.map((s) => ({
      id: s.id,
      started: formatDateTime(s.startedAt),
      until: formatDateTime(s.expiresAt),
      ip: s.ip ?? '—',
    })),
    audit: detail.audit.map((a) => ({
      id: a.id,
      when: formatDateTime(a.createdAt),
      action: actionLabel(a.action),
      by: a.actor ? a.actor.name : 'System',
    })),
  };
}

type Action = 'reset' | 'signOut' | 'unlock' | 'deactivate' | 'reactivate';

/**
 * /system/users/:id: one account, its terms, sign-ins, sessions and audit trail, every
 * action on it, and its organization's files (details only). Destructive actions are
 * confirmed and need a step-up code; a reset's password goes to the ISSC's Reveal, or (the
 * ISSC account's own) is shown here once.
 */
export function useSystemAccount(userId: string) {
  const queryClient = useQueryClient();
  const me = useAuth().user?.id;
  const stepUp = useStepUp();
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [editing, setEditing] = useState(false);
  const [locking, setLocking] = useState(false);
  const [shownPassword, setShownPassword] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: queryKeys.system.account(userId),
    queryFn: () => api.get(`/system/users/${userId}`, { schema: systemUserDetailSchema }),
    staleTime: 15_000,
  });
  const slug = detail.data?.account.organization?.slug;
  const files = useQuery({
    queryKey: queryKeys.system.supportDocuments(slug ?? ''),
    queryFn: () =>
      api.get(`/system/organizations/${slug}/documents`, { schema: supportDocumentListSchema }),
    enabled: !!slug,
    staleTime: 15_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.system.all });

  const editForm = useForm<EditAccountForm, unknown, z.output<typeof editAccountFormSchema>>({
    resolver: zodResolver(editAccountFormSchema),
  });
  const lockForm = useForm({
    resolver: zodResolver(lockFormSchema),
    defaultValues: { reason: '' },
  });

  const edit = useMutation({
    mutationFn: (values: z.output<typeof editAccountFormSchema>) =>
      api.patch(
        `/system/users/${userId}`,
        { ...values, termEnd: values.termEnd || null },
        { schema: systemUserSchema },
      ),
    onSuccess: () => {
      setEditing(false);
      toast.success('Account details saved');
    },
    onSettled: refresh,
  });

  const lock = useMutation({
    mutationFn: (reason: string) =>
      api.patch(
        `/system/users/${userId}/lock`,
        { locked: true, reason },
        { schema: systemUserSchema },
      ),
    onSuccess: () => {
      setLocking(false);
      lockForm.reset();
      toast.success('Account locked. Its sessions ended.');
    },
    onSettled: refresh,
  });

  const act = useMutation({
    mutationFn: async (action: Action) => {
      switch (action) {
        case 'reset':
          return stepUp.guard(() =>
            api.post(`/system/users/${userId}/password-reset`, undefined, {
              schema: passwordResetResponseSchema,
            }),
          );
        case 'signOut':
          return stepUp.guard(() =>
            api.post(`/system/users/${userId}/sign-out`, undefined, { schema: systemUserSchema }),
          );
        case 'unlock':
          return api.patch(
            `/system/users/${userId}/lock`,
            { locked: false },
            { schema: systemUserSchema },
          );
        case 'deactivate':
        case 'reactivate':
          return stepUp.guard(() =>
            api.patch(
              `/system/users/${userId}/status`,
              { active: action === 'reactivate' },
              { schema: systemUserSchema },
            ),
          );
      }
    },
    onSuccess: (result, action) => {
      if (!result) return;
      if (action === 'reset' && 'delivery' in result) {
        if (result.delivery.kind === 'shown_once') {
          setShownPassword(result.delivery.temporaryPassword);
        } else {
          toast.success(
            `New temporary password sent to the ISSC account’s Reveal (until ${formatDate(result.delivery.expiresAt)})`,
          );
        }
        return;
      }
      const done: Record<Exclude<Action, 'reset'>, string> = {
        signOut: 'Signed out everywhere',
        unlock: 'Account unlocked',
        deactivate: 'Account deactivated',
        reactivate: 'Account active again',
      };
      toast.success(done[action as Exclude<Action, 'reset'>]);
    },
    onError: (error) => toast.error(messageOf(error)),
    onSettled: refresh,
  });

  const support = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: 'rescan' | 'restore' }) =>
      api.post(`/system/documents/${id}/${kind}`),
    onSuccess: (_r, { kind }) =>
      toast.success(kind === 'rescan' ? 'Virus scan queued again' : 'File restored'),
    onError: (error) => toast.error(messageOf(error)),
    onSettled: refresh,
  });

  const ask = (action: Action, title: string, body: string, confirmLabel: string) =>
    setConfirming({
      kind: 'deactivate',
      title,
      body,
      confirmLabel,
      run: () => {
        setConfirming(null);
        act.mutate(action);
      },
    });

  if (detail.isPending) return { status: 'loading' as const };
  if (detail.isError) {
    return detail.error instanceof ApiError && detail.error.status === 404
      ? { status: 'not-found' as const }
      : { status: 'error' as const, retry: () => void detail.refetch() };
  }

  const account = detail.data.account;
  const summary = summaryOf(account, me);
  const isOrg = account.organization !== null;
  const name = account.organization?.acronym ?? account.name;

  return {
    status: 'ready' as const,
    summary,
    history: historyOf(detail.data),
    files: !isOrg
      ? null
      : files.isPending
        ? ({ status: 'loading' } as const)
        : files.isError
          ? ({ status: 'error', retry: () => void files.refetch() } as const)
          : ({ status: 'ready', rows: files.data.items.map(toFileRow) } as const),
    actions: {
      canEdit: isOrg,
      edit: () => {
        editForm.reset({
          email: account.email,
          officerInCharge: account.officerInCharge ?? { name: '', position: '', email: '' },
          termEnd: detail.data.terms.find((t) => t.endedAt === null)?.termEnd ?? '',
        });
        edit.reset();
        setEditing(true);
      },
      canReset: isOrg && !account.disabledAt,
      reset: () =>
        ask(
          'reset',
          `Issue a new temporary password for ${name}?`,
          summary.organization?.type === 'ISSC'
            ? 'Every session ends. The new password is shown to you once, since this is the ISSC account.'
            : 'Every session ends. The new password goes to the ISSC account’s one-time Reveal; you do not see it.',
          'Issue new password',
        ),
      canSignOut: !summary.isSelf,
      signOut: () =>
        ask(
          'signOut',
          `Sign ${name} out everywhere?`,
          'Every session of this account ends now.',
          'Sign out everywhere',
        ),
      canLock: isOrg && !account.lockedAt && !account.disabledAt,
      lock: () => {
        lock.reset();
        setLocking(true);
      },
      canUnlock: isOrg && !!account.lockedAt,
      unlock: () =>
        ask(
          'unlock',
          `Unlock ${name}?`,
          'It can sign in again with its current password.',
          'Unlock',
        ),
      canDeactivate: !account.disabledAt && !summary.isSelf,
      deactivate: () =>
        ask(
          'deactivate',
          `Deactivate ${name}?`,
          'It is signed out everywhere and cannot sign in until reactivated. Another account can then be made for the organization.',
          'Deactivate',
        ),
      canReactivate: !!account.disabledAt,
      reactivate: () =>
        ask(
          'reactivate',
          `Reactivate ${name}?`,
          'It can sign in again with its current password.',
          'Reactivate',
        ),
      busy: act.isPending,
    },
    support: {
      rescan: (id: string) => support.mutate({ id, kind: 'rescan' }),
      restore: (id: string) => support.mutate({ id, kind: 'restore' }),
      pendingId: support.isPending ? support.variables.id : null,
    },
    editDialog: {
      open: editing,
      register: editForm.register,
      errors: editForm.formState.errors,
      onSubmit: editForm.handleSubmit((values) => edit.mutate(values)),
      isSubmitting: edit.isPending,
      formError: edit.error ? messageOf(edit.error) : undefined,
      onCancel: () => setEditing(false),
    },
    lockDialog: {
      open: locking,
      register: lockForm.register,
      errors: lockForm.formState.errors,
      onSubmit: lockForm.handleSubmit(({ reason }) => lock.mutate(reason)),
      isSubmitting: lock.isPending,
      formError: lock.error ? messageOf(lock.error) : undefined,
      onCancel: () => setLocking(false),
    },
    shownPassword,
    closeShownPassword: () => setShownPassword(null),
    confirming,
    cancelConfirm: () => setConfirming(null),
    stepUp: stepUp.dialog,
  };
}

export type SystemAccountModel = ReturnType<typeof useSystemAccount>;
export type SystemAccountReady = Extract<SystemAccountModel, { status: 'ready' }>;
