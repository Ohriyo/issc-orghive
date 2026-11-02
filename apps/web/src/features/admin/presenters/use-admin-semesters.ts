import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminSemestersResponseSchema,
  SEMESTER_LABELS,
  setSemesterDatesRequestSchema,
  type AdminSemester,
  type AdminSemestersResponse,
} from '@orghive/shared';
import { useActingAs, type ActingAsModel } from '@/features/auth/presenters/use-acting-as';
import { formatManilaDate } from '@/features/projects/presenters/project-format';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export interface SemesterRow {
  id: string;
  /** "1st semester 2026-2027". */
  label: string;
  /** "Aug 17, 2026 to Dec 18, 2026". */
  dates: string;
  /** "Set by the ISSC" or "Usual dates". */
  source: string;
  /** "Provisional until Dec 25, 2026" or "Final". */
  standing: string;
  /** Final standings keep their dates. */
  locked: boolean;
  semester: AdminSemester;
}

export function toSemesterRow(semester: AdminSemester): SemesterRow {
  const final = semester.status === 'final';
  return {
    id: `${semester.academicYear}:${semester.semester}`,
    label: `${SEMESTER_LABELS[semester.semester]} ${semester.academicYear}`,
    dates: `${formatManilaDate(semester.start)} to ${formatManilaDate(semester.end)}`,
    source: semester.isSet ? 'Set by the ISSC' : 'Usual dates',
    standing: final
      ? 'Standings final'
      : `Standings provisional until ${formatManilaDate(semester.provisionalUntil)}`,
    locked: final,
    semester,
  };
}

export interface SemesterDialogModel {
  open: boolean;
  label: string;
  start: string;
  end: string;
  setStart: (value: string) => void;
  setEnd: (value: string) => void;
  actingAs: ActingAsModel;
  error: string | null;
  saving: boolean;
  submit: () => void;
  close: () => void;
}

export interface AdminSemestersModel {
  state:
    | { status: 'loading' }
    | { status: 'error'; retry: () => void }
    | { status: 'ready'; rows: SemesterRow[]; finalAfterDays: number };
  /** Opens the dates dialog for a semester. */
  edit: (row: SemesterRow) => void;
  /** Announced after a save. */
  saved: string | null;
  dialog: SemesterDialogModel;
}

const errorText = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : 'This could not be saved. Check your connection and try again.';

/**
 * /admin/semesters: the ISSC account sets each semester's first and last day, as the university
 * calendar varies (spec 5B). The API refuses dates out of place, and dates of final standings.
 */
export function useAdminSemesters(): AdminSemestersModel {
  const queryClient = useQueryClient();
  const actingAs = useActingAs();
  const key = [...queryKeys.admin.all, 'semesters'] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.get('/admin/semesters', { schema: adminSemestersResponseSchema }),
    staleTime: 60_000,
  });

  const [draft, setDraft] = useState<{
    row: SemesterRow;
    start: string;
    end: string;
    error: string | null;
  } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: ({ row, body }: { row: SemesterRow; body: object }) =>
      api.put(`/admin/semesters/${row.semester.academicYear}/${row.semester.semester}`, body, {
        schema: adminSemestersResponseSchema,
      }),
    onSuccess: async (response: AdminSemestersResponse, { row }) => {
      queryClient.setQueryData(key, response);
      setDraft(null);
      setSaved(`Saved the dates of ${row.label}. The leaderboards are being recomputed.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.semesters }),
        queryClient.invalidateQueries({ queryKey: ['leaderboard'] }),
        queryClient.invalidateQueries({ queryKey: ['me'] }),
      ]);
    },
    onError: (error) => setDraft((d) => d && { ...d, error: errorText(error) }),
  });

  const edit = (row: SemesterRow) => {
    setSaved(null);
    setDraft({ row, start: row.semester.start, end: row.semester.end, error: null });
  };

  return {
    state: query.isError
      ? { status: 'error', retry: () => void query.refetch() }
      : !query.data
        ? { status: 'loading' }
        : {
            status: 'ready',
            rows: query.data.semesters.map(toSemesterRow),
            finalAfterDays: query.data.finalAfterDays,
          },
    edit,
    saved,
    dialog: {
      open: draft !== null,
      label: draft?.row.label ?? '',
      start: draft?.start ?? '',
      end: draft?.end ?? '',
      setStart: (start) => setDraft((d) => d && { ...d, start, error: null }),
      setEnd: (end) => setDraft((d) => d && { ...d, end, error: null }),
      actingAs,
      error: draft?.error ?? null,
      saving: mutation.isPending,
      submit: () => {
        if (!draft) return;
        const name = actingAs.take();
        if (name === null) return;
        const parsed = setSemesterDatesRequestSchema.safeParse({
          start: draft.start,
          end: draft.end,
          actingAs: name,
        });
        if (!parsed.success) {
          setDraft({ ...draft, error: parsed.error.issues[0]?.message ?? 'Check the dates' });
          return;
        }
        mutation.mutate({ row: draft.row, body: parsed.data });
      },
      close: () => {
        setDraft(null);
        mutation.reset();
      },
    },
  };
}
