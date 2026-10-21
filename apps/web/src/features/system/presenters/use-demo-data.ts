import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  DEMO_DATA_KINDS,
  DEMO_DATA_LABELS,
  demoDataPreviewSchema,
  removeDemoDataResponseSchema,
} from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatCount, messageOf } from './system-format';
import type { Confirming } from './use-system-users';
import { useStepUp } from './use-step-up';

/**
 * The console's demo data banner (docs/DEPLOYMENT.md, "Demo data"): shown on every /system
 * page while any is_demo row exists. The super admin sees what would be removed, confirms,
 * then re-enters a code (step-up); the total the preview showed is sent along, so nothing
 * unseen is removed. The same removal as `pnpm --filter api db:unseed:demo`.
 */
export function useDemoData() {
  const queryClient = useQueryClient();
  const stepUp = useStepUp();
  const [confirming, setConfirming] = useState<Confirming | null>(null);

  const preview = useQuery({
    queryKey: queryKeys.system.demoData,
    queryFn: () => api.get('/system/demo-data', { schema: demoDataPreviewSchema }),
    staleTime: 30_000,
  });

  const remove = useMutation({
    mutationFn: (expectedTotal: number) =>
      stepUp.guard(() =>
        api.post(
          '/system/demo-data/delete',
          { expectedTotal },
          { schema: removeDemoDataResponseSchema },
        ),
      ),
    onSuccess: (result) => {
      if (result) toast.success('Demo data removed');
    },
    onError: (error) => toast.error(messageOf(error)),
    // Public pages and boards change too; drop everything cached.
    onSettled: () => queryClient.invalidateQueries(),
  });

  if (!preview.data || preview.data.total === 0) return { present: false as const };

  const { total, counts } = preview.data;
  const items = DEMO_DATA_KINDS.filter((kind) => counts[kind] > 0).map((kind) => ({
    kind,
    label: DEMO_DATA_LABELS[kind],
    count: counts[kind],
  }));
  return {
    present: true as const,
    total,
    items,
    removing: remove.isPending,
    askRemove: () =>
      setConfirming({
        kind: 'deactivate',
        title: `Remove ${formatCount(total)} demo rows?`,
        body: `${items.map((i) => `${formatCount(i.count)} ${i.label.toLowerCase()}`).join(', ')}, and every file under demo/. Real data is not touched. This cannot be undone; run db:seed:demo to make new demo data.`,
        confirmLabel: 'Remove demo data',
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

export type DemoDataModel = ReturnType<typeof useDemoData>;
