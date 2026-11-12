import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cacheStatsSchema, flushCacheResponseSchema, type CacheNamespace } from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatBytes } from './health-format';
import { formatCount, formatDateTime, messageOf } from './system-format';
import { useStepUp } from './use-step-up';
import type { Confirming } from './use-system-users';

/**
 * /system/tools, cache: how many cached reads each namespace holds, and flushing one after
 * a step-up. Sessions, rate limits and queues are never listed or flushed.
 */
export function useCacheTools() {
  const queryClient = useQueryClient();
  const stepUp = useStepUp();
  const [confirming, setConfirming] = useState<Confirming | null>(null);

  const stats = useQuery({
    queryKey: queryKeys.system.cache,
    queryFn: () => api.get('/system/cache', { schema: cacheStatsSchema }),
    staleTime: 10_000,
  });

  const flush = useMutation({
    mutationFn: (namespace: CacheNamespace) =>
      stepUp.guard(() =>
        api.post('/system/cache/flush', { namespace }, { schema: flushCacheResponseSchema }),
      ),
    onSuccess: (result) => {
      if (result) {
        toast.success(
          result.deleted === 1
            ? '1 cached entry flushed'
            : `${formatCount(result.deleted)} cached entries flushed`,
        );
      }
    },
    onError: (error) => toast.error(messageOf(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.system.cache }),
  });

  if (stats.isPending) return { status: 'loading' as const };
  if (stats.isError) return { status: 'error' as const, retry: () => void stats.refetch() };

  const data = stats.data;
  return {
    status: 'ready' as const,
    namespaces: data.namespaces.map((n) => ({
      id: n.id,
      label: n.label,
      description: n.description,
      keys: formatCount(n.keys),
      empty: n.keys === 0,
    })),
    whole: [
      data.totalKeys === null ? null : `${formatCount(data.totalKeys)} keys in Redis in all`,
      data.usedMemoryBytes === null ? null : `${formatBytes(data.usedMemoryBytes)} used`,
    ]
      .filter(Boolean)
      .join(' · '),
    generatedAt: formatDateTime(data.generatedAt),
    flushing: flush.isPending ? flush.variables : null,
    askFlush: (id: CacheNamespace) => {
      const namespace = data.namespaces.find((n) => n.id === id);
      if (!namespace) return;
      setConfirming({
        kind: 'deactivate',
        title: `Flush ${namespace.label}?`,
        body: `Its ${formatCount(namespace.keys)} cached entries are deleted. Nothing is lost: the next visits load from the database again, a little slower. You will be asked for an authenticator code.`,
        confirmLabel: 'Flush cache',
        run: () => {
          setConfirming(null);
          flush.mutate(id);
        },
      });
    },
    confirming,
    cancelConfirm: () => setConfirming(null),
    stepUp: stepUp.dialog,
  };
}

export type CacheToolsModel = ReturnType<typeof useCacheTools>;
