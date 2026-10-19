import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { deleteTestDataResponseSchema, testDataPreviewSchema } from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { actionLabel, formatCount, formatDate, messageOf } from './system-format';
import type { Confirming } from './use-system-users';
import { useStepUp } from './use-step-up';

/**
 * /system/test-data: files flagged as test data when `members` visibility was retired. The
 * super admin reviews the list, then deletes them all (soft delete, audited) after a step-up.
 * The count the preview showed is sent along: if anything changed, nothing is deleted.
 */
export function useTestData() {
  const queryClient = useQueryClient();
  const stepUp = useStepUp();
  const [confirming, setConfirming] = useState<Confirming | null>(null);

  const preview = useQuery({
    queryKey: queryKeys.system.testData,
    queryFn: () => api.get('/system/test-data', { schema: testDataPreviewSchema }),
    staleTime: 10_000,
  });

  const remove = useMutation({
    mutationFn: (expectedCount: number) =>
      stepUp.guard(() =>
        api.post(
          '/system/test-data/delete',
          { expectedCount },
          { schema: deleteTestDataResponseSchema },
        ),
      ),
    onSuccess: (result) => {
      if (result) toast.success(`${formatCount(result.deleted)} test files deleted`);
    },
    onError: (error) => toast.error(messageOf(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.system.all }),
  });

  if (preview.isPending) return { status: 'loading' as const };
  if (preview.isError) return { status: 'error' as const, retry: () => void preview.refetch() };

  const { total, items } = preview.data;
  return {
    status: 'ready' as const,
    total,
    shown: items.length,
    rows: items.map((item) => ({
      id: item.id,
      organization: item.organization.acronym,
      type: item.type,
      status: actionLabel(item.status),
      created: formatDate(item.createdAt),
    })),
    deleting: remove.isPending,
    askDelete: () =>
      setConfirming({
        kind: 'deactivate',
        title: `Delete ${formatCount(total)} test files?`,
        body: 'They leave every list and search at once. The deletion is soft (the rows stay for the audit trail) and each file is audited.',
        confirmLabel: 'Delete test data',
        run: () => {
          setConfirming(null);
          remove.mutate(total);
        },
      }),
    confirming,
    cancelConfirm: () => setConfirming(null),
    stepUp: stepUp.dialog,
  };
}

export type TestDataModel = ReturnType<typeof useTestData>;
