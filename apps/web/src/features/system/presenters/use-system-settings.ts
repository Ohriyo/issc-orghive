import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_LATE_POINTS,
  formatPoints,
  latePointsSchema,
  systemSettingsSchema,
} from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatDateTime, messageOf } from './system-format';

export type SystemSettingsModel =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | {
      status: 'ready';
      /** What the field shows: the saved value until edited. */
      latePoints: string;
      setLatePoints: (value: string) => void;
      /** "Default (0.5)" or "Changed Oct 20, 2026, 3:04 PM". */
      lastChange: string;
      /** What a late project earns with the typed value, e.g. "0.25 pt". */
      preview: string | null;
      error: string | null;
      saving: boolean;
      saved: boolean;
      dirty: boolean;
      save: () => void;
    };

/**
 * /system/settings: the leaderboard's late value (docs/PROJECT_WORKFLOW_SPEC.md, 5C). A
 * change is audited by the API and recomputes the current and previous semester's boards.
 */
export function useSystemSettings(): SystemSettingsModel {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = [...queryKeys.system.all, 'settings'] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.get('/system/settings', { schema: systemSettingsSchema }),
  });
  const mutation = useMutation({
    mutationFn: (leaderboardLatePoints: number) =>
      api.patch('/system/settings', { leaderboardLatePoints }, { schema: systemSettingsSchema }),
    onSuccess: async (settings) => {
      queryClient.setQueryData(key, settings);
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
    },
    onError: (err) => setError(messageOf(err)),
  });

  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  if (!query.data) return { status: 'loading' };

  const saved = query.data;
  const value = draft ?? formatPoints(saved.leaderboardLatePoints);
  const parsed = latePointsSchema.safeParse(value.trim() === '' ? NaN : Number(value));
  return {
    status: 'ready',
    latePoints: value,
    setLatePoints: (next) => {
      setDraft(next);
      setError(null);
      mutation.reset();
    },
    lastChange: saved.updatedAt
      ? `Changed ${formatDateTime(saved.updatedAt)}`
      : `The default (${formatPoints(DEFAULT_LATE_POINTS)})`,
    preview: parsed.success
      ? `${formatPoints(parsed.data)} ${parsed.data === 1 ? 'pt' : 'pts'}`
      : null,
    error,
    saving: mutation.isPending,
    saved: mutation.isSuccess,
    dirty: draft !== null && parsed.success && parsed.data !== saved.leaderboardLatePoints,
    save: () => {
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? 'Use a number from 0 to 1');
        return;
      }
      mutation.mutate(parsed.data);
    },
  };
}
