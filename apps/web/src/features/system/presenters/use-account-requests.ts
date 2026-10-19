import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import {
  accountRequestCountSchema,
  declineAccountRequestSchema,
  systemAccountRequestListSchema,
  systemAccountRequestSchema,
  type SystemAccountRequest,
} from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatDateTime, messageOf } from './system-format';

export type RequestFilter = 'requested' | 'all';

export interface RequestRow {
  id: string;
  organization: string;
  /** "CEA · SBO". */
  where: string;
  accountEmail: string;
  officer: string;
  note: string | null;
  requested: string;
  requestedBy: string;
  status: 'Requested' | 'Created' | 'Declined';
  declineReason: string | null;
  /** Open, and the organization still has no account. */
  canCreate: boolean;
  canDecline: boolean;
  createHref: string;
  accountHref: string | null;
}

function toRow(r: SystemAccountRequest): RequestRow {
  const open = r.status === 'requested';
  return {
    id: r.id,
    organization: `${r.organization.acronym} · ${r.organization.name}`,
    where: [r.organization.college, r.organization.type].filter(Boolean).join(' · '),
    accountEmail: r.accountEmail,
    officer: `${r.officerInCharge.name}, ${r.officerInCharge.position} (${r.officerInCharge.email})`,
    note: r.note,
    requested: formatDateTime(r.requestedAt),
    requestedBy: r.requestedBy?.name ?? 'Unknown',
    status:
      r.status === 'requested' ? 'Requested' : r.status === 'created' ? 'Created' : 'Declined',
    declineReason: r.declineReason,
    canCreate: open && !r.organization.hasAccount,
    canDecline: open,
    createHref: `/system/users/new?request=${r.id}`,
    accountHref: r.createdAccountId ? `/system/users/${r.createdAccountId}` : null,
  };
}

/** The sidebar badge: open requests. A background read, so it is never audited as a page. */
export function useOpenRequestCount(): number {
  const count = useQuery({
    queryKey: [...queryKeys.system.all, 'account-requests', 'count'],
    queryFn: () =>
      api.get('/system/account-requests/count', {
        schema: accountRequestCountSchema,
        background: true,
      }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return count.data?.open ?? 0;
}

/** One request, for the create-account form to start from. */
export function useAccountRequest(id: string | null) {
  return useQuery({
    queryKey: [...queryKeys.system.all, 'account-requests', id],
    queryFn: () =>
      api.get(`/system/account-requests/${id}`, { schema: systemAccountRequestSchema }),
    enabled: id !== null,
    staleTime: 10_000,
  });
}

/**
 * /system/account-requests: what the ISSC account asked for, oldest open first. "Create
 * account" opens the create form filled in from the request; "Decline" needs a reason, which
 * the ISSC account is told.
 */
export function useAccountRequests() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<RequestFilter>('requested');
  const [declining, setDeclining] = useState<RequestRow | null>(null);
  const form = useForm({
    resolver: zodResolver(declineAccountRequestSchema),
    defaultValues: { reason: '' },
  });

  const list = useQuery({
    queryKey: [...queryKeys.system.all, 'account-requests', 'list', filter],
    queryFn: () =>
      api.get(`/system/account-requests?status=${filter}`, {
        schema: systemAccountRequestListSchema,
      }),
    staleTime: 15_000,
  });

  const decline = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(
        `/system/account-requests/${id}/decline`,
        { reason },
        {
          schema: systemAccountRequestSchema,
        },
      ),
    onSuccess: (request) => {
      setDeclining(null);
      form.reset();
      toast.success(`Declined. The ISSC account was told why (${request.organization.acronym}).`);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.system.all }),
  });

  return {
    filter,
    setFilter,
    list: list.isPending
      ? ({ status: 'loading' } as const)
      : list.isError
        ? ({ status: 'error', retry: () => void list.refetch() } as const)
        : ({
            status: 'ready',
            rows: list.data.items.map(toRow),
            openCount: list.data.openCount,
          } as const),
    askDecline: (row: RequestRow) => {
      form.reset();
      decline.reset();
      setDeclining(row);
    },
    declineDialog: {
      open: declining !== null,
      organization: declining?.organization ?? '',
      register: form.register,
      errors: form.formState.errors,
      onSubmit: form.handleSubmit(({ reason }) => {
        if (declining) decline.mutate({ id: declining.id, reason });
      }),
      isSubmitting: decline.isPending,
      formError: decline.error ? messageOf(decline.error) : undefined,
      onCancel: () => setDeclining(null),
    },
  };
}

export type AccountRequestsModel = ReturnType<typeof useAccountRequests>;
