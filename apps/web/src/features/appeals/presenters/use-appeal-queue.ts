import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  addDays,
  appealListResponseSchema,
  appealSchema,
  attachmentDownloadResponseSchema,
  decideAppealRequestSchema,
  manilaDate,
  type DecideAppealRequest,
} from '@orghive/shared';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { toAppealItem, type AppealItem } from './appeal-format';

export type QueueTab = 'pending' | 'decided';

/** The decision form of one appeal. */
export interface DecisionDraft {
  mode: 'idle' | 'approve' | 'reject';
  newDueDate: string;
  remarks: string;
  errors: { newDueDate?: string; remarks?: string; form?: string };
  saving: boolean;
}

export interface QueueItem extends AppealItem {
  draft: DecisionDraft;
  choose: (mode: DecisionDraft['mode']) => void;
  edit: (patch: Partial<Pick<DecisionDraft, 'newDueDate' | 'remarks'>>) => void;
  confirm: () => void;
  openAttachment: (attachmentId: string) => void;
}

export type AppealQueueModel = {
  tab: QueueTab;
  setTab: (tab: QueueTab) => void;
  /** The earliest due date a reviewer may set: tomorrow in Manila. */
  minDueDate: string;
} & (
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; items: QueueItem[] }
);

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && (error.status === 0 || error.status < 500)) return error.message;
  return 'Something went wrong on our side. Try again in a moment.';
}

/** Opens a 5-minute download link for an appeal's supporting file (audited server-side). */
export async function openAppealAttachment(appealId: string, attachmentId: string) {
  try {
    const { url } = await api.get(`/appeals/${appealId}/attachments/${attachmentId}/download`, {
      schema: attachmentDownloadResponseSchema,
    });
    window.location.assign(url);
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

/**
 * /dashboard/appeals: the appeals waiting for this account's decision (a CSC account for
 * its SBOs, the ISSC account for the CSCs; appeal-rules.ts on the server decides), and
 * the ones it decided. Approve needs a new due date; reject needs remarks.
 */
export function useAppealQueue(): AppealQueueModel {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab: QueueTab = params.get('tab') === 'decided' ? 'decided' : 'pending';
  const [drafts, setDrafts] = useState<Record<string, DecisionDraft>>({});
  const minDueDate = addDays(manilaDate(new Date()), 1);

  const query = useQuery({
    queryKey: queryKeys.appeals.queue(tab),
    queryFn: () => api.get(`/appeals/queue?status=${tab}`, { schema: appealListResponseSchema }),
    staleTime: 30_000,
  });
  const decide = useMutation({
    mutationFn: ({ id, body }: { id: string; body: DecideAppealRequest }) =>
      api.post(`/appeals/${id}/decision`, body, { schema: appealSchema }),
  });

  const base = {
    tab,
    minDueDate,
    setTab: (next: QueueTab) =>
      setParams(next === 'pending' ? {} : { tab: next }, { replace: true }),
  };
  if (query.isError) return { ...base, status: 'error', retry: () => void query.refetch() };
  if (!query.data) return { ...base, status: 'loading' };

  const draftOf = (id: string): DecisionDraft =>
    drafts[id] ?? { mode: 'idle', newDueDate: '', remarks: '', errors: {}, saving: false };
  const patch = (id: string, next: Partial<DecisionDraft>) =>
    setDrafts((all) => ({ ...all, [id]: { ...draftOf(id), ...all[id], ...next } }));

  async function confirm(id: string) {
    const draft = draftOf(id);
    const parsed = decideAppealRequestSchema.safeParse(
      draft.mode === 'approve'
        ? { decision: 'approve', newDueDate: draft.newDueDate, remarks: draft.remarks }
        : { decision: 'reject', remarks: draft.remarks },
    );
    if (!parsed.success) {
      const errors: DecisionDraft['errors'] = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'newDueDate' || field === 'remarks') errors[field] ??= issue.message;
      }
      patch(id, { errors });
      return;
    }
    patch(id, { errors: {}, saving: true });
    try {
      const decided = await decide.mutateAsync({ id, body: parsed.data });
      toast.success(
        decided.status === 'approved'
          ? `Approved. ${decided.organization.acronym} can continue.`
          : `Rejected. ${decided.organization.acronym} sees your remarks and may appeal again.`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.appeals.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.all }),
      ]);
      setDrafts((all) => {
        const { [id]: _, ...rest } = all;
        return rest;
      });
    } catch (error) {
      patch(id, { saving: false, errors: { form: errorMessage(error) } });
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.appeals.all });
      }
    }
  }

  return {
    ...base,
    status: 'ready',
    items: query.data.items.map((appeal) => {
      const id = appeal.id;
      return {
        ...toAppealItem(appeal),
        draft: draftOf(id),
        choose: (mode) => patch(id, { mode, errors: {} }),
        edit: (next) => patch(id, next),
        confirm: () => void confirm(id),
        openAttachment: (attachmentId) => void openAppealAttachment(id, attachmentId),
      };
    }),
  };
}
