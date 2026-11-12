import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  alertCooldownMinutesSchema,
  DEFAULT_ALERT_COOLDOWN_MINUTES,
  DEFAULT_FINAL_AFTER_DAYS,
  DEFAULT_LATE_POINTS,
  finalAfterDaysSchema,
  formatPoints,
  latePointsSchema,
  systemSettingsSchema,
  type CheckedTaskType,
  type UpdateSystemSettingsRequest,
} from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import {
  checkSettingsChanged,
  parseCheckSettings,
  type CheckField,
  type CheckSettingsDraft,
} from './check-settings';
import { formatDateTime, messageOf } from './system-format';

/** How long standings stay provisional after a semester's last day (spec 5B). */
export interface FinalAfterDaysModel {
  value: string;
  onChange: (value: string) => void;
  lastChange: string;
  error: string | null;
  saving: boolean;
  saved: boolean;
  dirty: boolean;
  save: () => void;
}

/** The task file checks' settings (spec section 6): keywords and the near-duplicate threshold. */
export interface CheckSettingsModel {
  nearBits: CheckField & { onChange: (value: string) => void };
  /** One field per checked task: its phrases, one a line, `|` between alternatives. */
  keywords: (CheckField & {
    type: CheckedTaskType;
    label: string;
    onChange: (value: string) => void;
  })[];
  /** "Using the defaults" or "Changed Oct 20, 2026, 3:04 PM". */
  lastChange: string;
  error: string | null;
  saving: boolean;
  saved: boolean;
  dirty: boolean;
  save: () => void;
}

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
      checks: CheckSettingsModel;
      finalAfterDays: FinalAfterDaysModel;
      /** Minutes before the same kind of system alert is emailed again. */
      alertCooldown: FinalAfterDaysModel;
    };

/**
 * /system/settings: the leaderboard's late value (docs/PROJECT_WORKFLOW_SPEC.md, 5C). A
 * change is audited by the API and recomputes the current and previous semester's boards.
 */
export function useSystemSettings(): SystemSettingsModel {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checksDraft, setChecksDraft] = useState<CheckSettingsDraft>({ keywords: {} });
  const [checksError, setChecksError] = useState<string | null>(null);
  const [daysDraft, setDaysDraft] = useState<string | null>(null);
  const [daysError, setDaysError] = useState<string | null>(null);
  const [cooldownDraft, setCooldownDraft] = useState<string | null>(null);
  const [cooldownError, setCooldownError] = useState<string | null>(null);
  const key = [...queryKeys.system.all, 'settings'] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.get('/system/settings', { schema: systemSettingsSchema }),
  });
  const checksMutation = useMutation({
    mutationFn: (patch: UpdateSystemSettingsRequest) =>
      api.patch('/system/settings', patch, { schema: systemSettingsSchema }),
    onSuccess: (settings) => {
      queryClient.setQueryData(key, settings);
      setChecksDraft({ keywords: {} });
    },
    onError: (err) => setChecksError(messageOf(err)),
  });
  const daysMutation = useMutation({
    mutationFn: (finalAfterDays: number) =>
      api.patch('/system/settings', { finalAfterDays }, { schema: systemSettingsSchema }),
    onSuccess: async (settings) => {
      queryClient.setQueryData(key, settings);
      setDaysDraft(null);
      await queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
    },
    onError: (err) => setDaysError(messageOf(err)),
  });
  const cooldownMutation = useMutation({
    mutationFn: (alertCooldownMinutes: number) =>
      api.patch('/system/settings', { alertCooldownMinutes }, { schema: systemSettingsSchema }),
    onSuccess: (settings) => {
      queryClient.setQueryData(key, settings);
      setCooldownDraft(null);
    },
    onError: (err) => setCooldownError(messageOf(err)),
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
  const checks = parseCheckSettings(saved, checksDraft);
  const daysValue = daysDraft ?? String(saved.finalAfterDays);
  const daysParsed = finalAfterDaysSchema.safeParse(
    daysValue.trim() === '' ? NaN : Number(daysValue),
  );
  const cooldownValue = cooldownDraft ?? String(saved.alertCooldownMinutes);
  const cooldownParsed = alertCooldownMinutesSchema.safeParse(
    cooldownValue.trim() === '' ? NaN : Number(cooldownValue),
  );
  const editChecks = (next: CheckSettingsDraft) => {
    setChecksDraft(next);
    setChecksError(null);
    checksMutation.reset();
  };
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
    finalAfterDays: {
      value: daysValue,
      onChange: (next) => {
        setDaysDraft(next);
        setDaysError(null);
        daysMutation.reset();
      },
      lastChange: saved.finalAfterDaysUpdatedAt
        ? `Changed ${formatDateTime(saved.finalAfterDaysUpdatedAt)}`
        : `The default (${DEFAULT_FINAL_AFTER_DAYS} days)`,
      error: daysError,
      saving: daysMutation.isPending,
      saved: daysMutation.isSuccess,
      dirty: daysDraft !== null && daysParsed.success && daysParsed.data !== saved.finalAfterDays,
      save: () => {
        if (!daysParsed.success) {
          setDaysError(daysParsed.error.issues[0]?.message ?? 'Use a number of days');
          return;
        }
        daysMutation.mutate(daysParsed.data);
      },
    },
    alertCooldown: {
      value: cooldownValue,
      onChange: (next) => {
        setCooldownDraft(next);
        setCooldownError(null);
        cooldownMutation.reset();
      },
      lastChange: saved.alertCooldownUpdatedAt
        ? `Changed ${formatDateTime(saved.alertCooldownUpdatedAt)}`
        : `The default (${DEFAULT_ALERT_COOLDOWN_MINUTES} minutes)`,
      error: cooldownError,
      saving: cooldownMutation.isPending,
      saved: cooldownMutation.isSuccess,
      dirty:
        cooldownDraft !== null &&
        cooldownParsed.success &&
        cooldownParsed.data !== saved.alertCooldownMinutes,
      save: () => {
        if (!cooldownParsed.success) {
          setCooldownError(cooldownParsed.error.issues[0]?.message ?? 'Use a number of minutes');
          return;
        }
        cooldownMutation.mutate(cooldownParsed.data);
      },
    },
    checks: {
      nearBits: {
        ...checks.nearBits,
        onChange: (next) => editChecks({ ...checksDraft, nearBits: next }),
      },
      keywords: checks.keywords.map((field) => ({
        ...field,
        onChange: (next) =>
          editChecks({ ...checksDraft, keywords: { ...checksDraft.keywords, [field.type]: next } }),
      })),
      lastChange: saved.checksUpdatedAt
        ? `Changed ${formatDateTime(saved.checksUpdatedAt)}`
        : 'Using the defaults',
      error: checksError,
      saving: checksMutation.isPending,
      saved: checksMutation.isSuccess,
      dirty: checks.value !== null && checkSettingsChanged(saved, checks.value),
      save: () => {
        if (!checks.value) {
          setChecksError('Fix the fields marked below.');
          return;
        }
        checksMutation.mutate(checks.value);
      },
    },
  };
}
