import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { documentSummarySchema, type DocumentVisibility } from '@orghive/shared';
import { VISIBILITY_LABEL } from '@/components/visibility';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export interface SetVisibility {
  /** Saves who can see a document; resolves with an error message, if any. */
  change: (documentId: string, visibility: DocumentVisibility) => Promise<string | undefined>;
  /** The document a change is being saved for, to disable its control. */
  pendingId: string | null;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) {
    return 'Only this organization’s own account can change who sees its documents.';
  }
  if (error instanceof ApiError && (error.status === 0 || error.status < 500)) return error.message;
  return 'Something went wrong on our side. Try again in a moment.';
}

/**
 * PATCH /documents/:id/visibility for the organization's own account. The API refuses every
 * other account; views only offer the control to it. Every document list and the dashboard refresh.
 */
export function useSetVisibility(): SetVisibility {
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: ({ id, visibility }: { id: string; visibility: DocumentVisibility }) =>
      api.patch(`/documents/${id}/visibility`, { visibility }, { schema: documentSummarySchema }),
    onSuccess: (doc) => queryClient.setQueryData(queryKeys.documents.detail(doc.id), doc),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['documents'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ]),
  });

  return {
    pendingId,
    async change(documentId, visibility) {
      setPendingId(documentId);
      try {
        await mutation.mutateAsync({ id: documentId, visibility });
        toast.success(`Now visible to: ${VISIBILITY_LABEL[visibility]}.`);
        return undefined;
      } catch (error) {
        return errorMessage(error);
      } finally {
        setPendingId(null);
      }
    },
  };
}
