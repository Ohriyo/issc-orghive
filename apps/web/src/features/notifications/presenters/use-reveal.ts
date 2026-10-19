import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  revealResponseSchema,
  revealStatusSchema,
  toCsv,
  type RevealEntry,
  type RevealStatus,
} from '@orghive/shared';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

const date = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' });

/** The handover list as a spreadsheet, built in the browser; never sent or stored. */
export function handoverCsv(entries: RevealEntry[]): string {
  return toCsv([
    ['Organization', 'Account email', 'Temporary password', 'Officer in charge', 'Officer email'],
    ...entries.map((e) => [
      e.organization.acronym,
      e.email,
      e.temporaryPassword,
      e.officerInCharge?.name ?? '',
      e.officerInCharge?.email ?? '',
    ]),
  ]);
}

export type RevealState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'available'; count: number; until: string; reveal: () => void; revealing: boolean }
  | { status: 'revealed'; entries: RevealEntry[]; download: () => void }
  | { status: 'gone'; message: string };

function goneMessage(status: RevealStatus): string {
  return status.status === 'revealed'
    ? `These passwords were already revealed on ${date.format(new Date(status.revealedAt!))}. Ask the super admin for a new password if one was lost.`
    : 'These passwords expired unrevealed. Ask the super admin for new ones.';
}

/**
 * The one-time Reveal (docs/DOMAIN_RULES.md, "Accounts"). The passwords live only in this
 * component's memory after the reveal: `forget()` (closing the dialog) drops them, and the
 * server has already erased its copy.
 */
export function useReveal(revealId: string | null): {
  state: RevealState | null;
  forget: () => void;
} {
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState<{ id: string; entries: RevealEntry[] } | null>(null);

  const status = useQuery({
    queryKey: ['reveal', revealId],
    queryFn: () => api.get(`/me/reveals/${revealId}`, { schema: revealStatusSchema }),
    enabled: revealId !== null,
    staleTime: 0,
    gcTime: 0,
  });
  const reveal = useMutation({
    mutationFn: (id: string) =>
      api.post(`/me/reveals/${id}/reveal`, undefined, { schema: revealResponseSchema }),
    onSuccess: (data, id) => setEntries({ id, entries: data.entries }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['reveal'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    },
  });

  const forget = () => {
    setEntries(null);
    reveal.reset();
  };
  const out = (state: RevealState | null) => ({ state, forget });

  if (revealId === null) return out(null);
  if (entries?.id === revealId) {
    return out({
      status: 'revealed',
      entries: entries.entries,
      download: () => {
        const blob = new Blob([handoverCsv(entries.entries)], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'orghive-temporary-passwords.csv';
        link.click();
        URL.revokeObjectURL(url);
      },
    });
  }
  if (reveal.error) {
    return out(
      reveal.error instanceof ApiError && reveal.error.status === 410
        ? { status: 'gone', message: reveal.error.message }
        : {
            status: 'error',
            message: 'The passwords could not be revealed. Try again in a moment.',
          },
    );
  }
  if (status.isPending) return out({ status: 'loading' });
  if (status.isError) {
    return out({ status: 'error', message: 'This Reveal could not be found for your account.' });
  }
  if (status.data.status !== 'available') {
    return out({ status: 'gone', message: goneMessage(status.data) });
  }
  return out({
    status: 'available',
    count: status.data.entryCount,
    until: date.format(new Date(status.data.expiresAt)),
    reveal: () => reveal.mutate(revealId),
    revealing: reveal.isPending,
  });
}
