import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  disqualificationsResponseSchema,
  disqualifyRequestSchema,
  liftDisqualificationRequestSchema,
  type Disqualification,
} from '@orghive/shared';
import { useActingAs, type ActingAsModel } from '@/features/auth/presenters/use-acting-as';
import {
  parseSemesterValue,
  semesterChoices,
  semesterLabel,
  semesterValue,
} from '@/features/leaderboard/presenters/leaderboard-model';
import { formatManilaDate } from '@/features/projects/presenters/project-format';
import { useSemesterCalendar } from '@/features/semesters/presenters/use-semester-calendar';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export interface DisqualificationRow {
  id: string;
  /** "JPICE (SBO)". */
  organization: string;
  reason: string;
  /** "By Ana Reyes on Nov 2, 2026". */
  by: string;
  /** "Lifted by Ben Cruz on Nov 5, 2026: “…”"; null while it stands. */
  lifted: string | null;
}

export function toDisqualificationRow(item: Disqualification): DisqualificationRow {
  return {
    id: item.id,
    organization: `${item.organization.acronym} (${item.organization.type})`,
    reason: item.reason,
    by: `By ${item.actingAs} on ${formatManilaDate(item.createdAt)}`,
    lifted: item.lifted
      ? `Lifted by ${item.lifted.actingAs} on ${formatManilaDate(item.lifted.at)}: “${item.lifted.reason}”`
      : null,
  };
}

export interface PenaltyDialogModel {
  /** Null when closed; which of the two forms is open. */
  mode: 'disqualify' | 'lift' | null;
  /** The lift form's organization. */
  organization: string;
  /** The disqualify form's choices. */
  organizations: { value: string; label: string }[];
  organizationId: string;
  setOrganizationId: (value: string) => void;
  reason: string;
  setReason: (value: string) => void;
  actingAs: ActingAsModel;
  error: string | null;
  saving: boolean;
  submit: () => void;
  close: () => void;
}

export type DisqualificationsState =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; final: boolean; rows: DisqualificationRow[] };

export interface AdminDisqualificationsModel {
  semester: { value: string; label: string; options: { value: string; label: string }[] };
  setSemester: (value: string) => void;
  state: DisqualificationsState;
  disqualify: () => void;
  lift: (row: DisqualificationRow) => void;
  dialog: PenaltyDialogModel;
}

const errorText = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : 'This could not be saved. Check your connection and try again.';

interface Draft {
  mode: 'disqualify' | 'lift';
  row: DisqualificationRow | null;
  organizationId: string;
  reason: string;
  error: string | null;
}

/**
 * /admin/disqualifications: the ISSC account disqualifies an organization from a semester's
 * leaderboard with a reason, and can lift it with a reason (spec 5B). Audited by the API, and
 * refused once the standings are final.
 */
export function useAdminDisqualifications(
  now: () => Date = () => new Date(),
): AdminDisqualificationsModel {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const actingAs = useActingAs();
  const calendar = useSemesterCalendar();
  const options = semesterChoices(now(), calendar);
  const picked = parseSemesterValue(params.get('semester'));
  const semester = picked ?? parseSemesterValue(options[0]!.value)!;
  const value = semesterValue(semester);
  if (!options.some((o) => o.value === value)) {
    options.push({ value, label: semesterLabel(semester) });
  }

  const key = [...queryKeys.admin.all, 'disqualifications', value] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get(
        `/admin/disqualifications?academicYear=${semester.academicYear}&semester=${semester.semester}`,
        { schema: disqualificationsResponseSchema },
      ),
    staleTime: 60_000,
  });

  const [draft, setDraft] = useState<Draft | null>(null);
  const mutation = useMutation({
    mutationFn: ({ path, body }: { path: string; body: object }) => api.post(path, body),
    onSuccess: async () => {
      setDraft(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: key }),
        queryClient.invalidateQueries({ queryKey: ['leaderboard'] }),
      ]);
    },
    onError: (error) => setDraft((d) => d && { ...d, error: errorText(error) }),
  });

  const submit = () => {
    if (!draft) return;
    const name = actingAs.take();
    if (name === null) return;
    const parsed =
      draft.mode === 'disqualify'
        ? disqualifyRequestSchema.safeParse({
            organizationId: draft.organizationId,
            ...semester,
            reason: draft.reason,
            actingAs: name,
          })
        : liftDisqualificationRequestSchema.safeParse({ reason: draft.reason, actingAs: name });
    if (!parsed.success) {
      setDraft({ ...draft, error: parsed.error.issues[0]?.message ?? 'Check the form' });
      return;
    }
    mutation.mutate({
      path:
        draft.mode === 'disqualify'
          ? '/admin/disqualifications'
          : `/admin/disqualifications/${draft.row!.id}/lift`,
      body: parsed.data,
    });
  };

  const open = (next: Pick<Draft, 'mode' | 'row'>) =>
    setDraft({ ...next, organizationId: '', reason: '', error: null });

  return {
    semester: { value, label: semesterLabel(semester), options },
    setSemester: (next) =>
      setParams(next === options[0]!.value ? {} : { semester: next }, { replace: true }),
    state: query.isError
      ? { status: 'error', retry: () => void query.refetch() }
      : !query.data
        ? { status: 'loading' }
        : {
            status: 'ready',
            final: query.data.status === 'final',
            rows: query.data.items.map(toDisqualificationRow),
          },
    disqualify: () => open({ mode: 'disqualify', row: null }),
    lift: (row) => open({ mode: 'lift', row }),
    dialog: {
      mode: draft?.mode ?? null,
      organization: draft?.row?.organization ?? '',
      organizations: (query.data?.organizations ?? []).map((org) => ({
        value: org.id,
        label: `${org.acronym} (${org.type})`,
      })),
      organizationId: draft?.organizationId ?? '',
      setOrganizationId: (organizationId) =>
        setDraft((d) => d && { ...d, organizationId, error: null }),
      reason: draft?.reason ?? '',
      setReason: (reason) => setDraft((d) => d && { ...d, reason, error: null }),
      actingAs,
      error: draft?.error ?? null,
      saving: mutation.isPending,
      submit,
      close: () => {
        setDraft(null);
        mutation.reset();
      },
    },
  };
}
