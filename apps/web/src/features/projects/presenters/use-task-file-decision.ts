import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  clearTaskFileWarningsRequestSchema,
  flagTaskFileRequestSchema,
  taskFileDecisionResponseSchema,
  type TaskFileIntegrity,
} from '@orghive/shared';
import { useActingAs, type ActingAsModel } from '@/features/auth/presenters/use-acting-as';
import { useAuth } from '@/features/auth/presenters/use-auth';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export type DecisionMode = 'clear' | 'flag';

/** A task file a governing body may decide on (spec section 6). */
export interface DecisionTarget {
  documentId: string;
  /** "Project Proposal, Seminar (JPICE)": what the dialog names. */
  name: string;
  /** Its warnings, or the flag's reason. */
  reasons: string[];
}

/** "Clear warning" and "Flag invalid" on one file; null when the action does not apply. */
export interface DecisionActions {
  clear: (() => void) | null;
  flag: (() => void) | null;
}

export interface TaskFileDecisionModel {
  /** The open dialog; null when closed. */
  open: { mode: DecisionMode; target: DecisionTarget } | null;
  close: () => void;
  /** The file's actions, by its checks: clear only with warnings, flag unless flagged. */
  actionsFor: (target: DecisionTarget, integrity: TaskFileIntegrity | null) => DecisionActions;
  reason: { value: string; error: string | undefined; onChange: (value: string) => void };
  note: { value: string; error: string | undefined; onChange: (value: string) => void };
  actingAs: ActingAsModel;
  /** The deciding council, for the "Acting as" hint: "CSC-CEA". */
  orgAcronym: string;
  submit: () => void;
  saving: boolean;
  error: string | null;
}

const FLAGGABLE = new Set<TaskFileIntegrity['state']>(['verified', 'needs_attention', 'legacy']);

/**
 * A governing body (the college's CSC, or the ISSC) clears a task file's warnings, so it
 * counts as verified, or flags it invalid, so it no longer counts until re-uploaded. Both are
 * audited with who acted; the organization is told. The API decides who may.
 */
export function useTaskFileDecision(): TaskFileDecisionModel {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const actingAs = useActingAs();
  const [open, setOpen] = useState<TaskFileDecisionModel['open']>(null);
  const [reason, setReason] = useState({ value: '', error: undefined as string | undefined });
  const [note, setNote] = useState({ value: '', error: undefined as string | undefined });
  const mutation = useMutation({
    mutationFn: ({
      mode,
      documentId,
      body,
    }: {
      mode: DecisionMode;
      documentId: string;
      body: object;
    }) =>
      api.post(
        `/task-files/${documentId}/integrity/${mode === 'clear' ? 'clear-warnings' : 'flag'}`,
        body,
        { schema: taskFileDecisionResponseSchema },
      ),
    onSuccess: async () => {
      setOpen(null);
      // The compliance overview and project pages live under 'projects'.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.all }),
        queryClient.invalidateQueries({ queryKey: ['leaderboard'] }),
      ]);
    },
  });

  const start = (mode: DecisionMode, target: DecisionTarget) => {
    mutation.reset();
    setReason({ value: '', error: undefined });
    setNote({ value: '', error: undefined });
    setOpen({ mode, target });
  };

  return {
    open,
    close: () => setOpen(null),
    actionsFor: (target, integrity) => ({
      clear: integrity?.state === 'needs_attention' ? () => start('clear', target) : null,
      flag: integrity && FLAGGABLE.has(integrity.state) ? () => start('flag', target) : null,
    }),
    reason: { ...reason, onChange: (value) => setReason({ value, error: undefined }) },
    note: { ...note, onChange: (value) => setNote({ value, error: undefined }) },
    actingAs,
    orgAcronym: user?.organization?.acronym ?? 'your council',
    submit: () => {
      if (!open) return;
      const name = actingAs.take();
      if (open.mode === 'flag') {
        const parsed = flagTaskFileRequestSchema.shape.reason.safeParse(reason.value);
        if (!parsed.success) {
          setReason({ value: reason.value, error: parsed.error.issues[0]?.message });
          return;
        }
        if (!name) return;
        mutation.mutate({
          mode: 'flag',
          documentId: open.target.documentId,
          body: { reason: parsed.data, actingAs: name },
        });
        return;
      }
      const parsed = clearTaskFileWarningsRequestSchema.shape.note.safeParse(
        note.value.trim() || undefined,
      );
      if (!parsed.success) {
        setNote({ value: note.value, error: parsed.error.issues[0]?.message });
        return;
      }
      if (!name) return;
      mutation.mutate({
        mode: 'clear',
        documentId: open.target.documentId,
        body: { ...(parsed.data && { note: parsed.data }), actingAs: name },
      });
    },
    saving: mutation.isPending,
    error:
      mutation.error instanceof ApiError
        ? mutation.error.message
        : mutation.error
          ? 'The decision could not be saved. Check your connection and try again.'
          : null,
  };
}
