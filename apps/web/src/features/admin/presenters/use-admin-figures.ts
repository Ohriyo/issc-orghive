import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  financialFiguresListResponseSchema,
  flagFinancialFiguresRequestSchema,
  formatPesos,
  type FinancialFiguresListItem,
} from '@orghive/shared';
import {
  parseSemesterValue,
  semesterChoices,
  semesterLabel,
  semesterValue,
} from '@/features/leaderboard/presenters/leaderboard-model';
import { formatManilaDate } from '@/features/projects/presenters/project-format';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export interface FiguresRow {
  projectId: string;
  projectName: string;
  projectHref: string;
  org: string;
  eventDate: string;
  income: string;
  expenses: string;
  net: string;
  negative: boolean;
  /** The ISSC's remark and since when; null when the figures count. */
  review: { remark: string; since: string } | null;
}

export function toFiguresRow(item: FinancialFiguresListItem): FiguresRow {
  return {
    projectId: item.projectId,
    projectName: item.projectName,
    projectHref: `/projects/${item.projectId}`,
    org: item.organization.acronym,
    eventDate: formatManilaDate(item.targetDate),
    income: formatPesos(item.incomeCentavos),
    expenses: formatPesos(item.expensesCentavos),
    net: formatPesos(item.netCentavos),
    negative: item.netCentavos < 0,
    review: item.underReview
      ? { remark: item.underReview.remark, since: formatManilaDate(item.underReview.flaggedAt) }
      : null,
  };
}

/** Figures under review first (they wait on the ISSC), then by organization and event. */
export function sortRows(rows: FiguresRow[]): FiguresRow[] {
  return [...rows].sort(
    (a, b) => Number(!!b.review) - Number(!!a.review) || a.org.localeCompare(b.org, 'en'),
  );
}

export interface FlagDialogModel {
  open: boolean;
  projectName: string;
  remark: string;
  setRemark: (value: string) => void;
  error: string | null;
  saving: boolean;
  submit: () => void;
  close: () => void;
}

export type AdminFiguresState =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; rows: FiguresRow[]; underReview: number };

export interface AdminFiguresModel {
  semester: { value: string; label: string; options: { value: string; label: string }[] };
  setSemester: (value: string) => void;
  state: AdminFiguresState;
  /** Opens the remark dialog for a project's figures. */
  flag: (row: FiguresRow) => void;
  /** Clears a review: the figures count again. */
  clear: (row: FiguresRow) => void;
  /** The project whose review is being cleared. */
  clearing: string | null;
  dialog: FlagDialogModel;
}

const errorText = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : 'This could not be saved. Check your connection and try again.';

/**
 * /admin/financial-figures: the ISSC checks the totals organizations reported in their
 * Financial Reports (spec 5D) and can put any under review, with a remark, which leaves them
 * out of the profit total until cleared. Not document review: the file is untouched.
 */
export function useAdminFigures(now: () => Date = () => new Date()): AdminFiguresModel {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const options = semesterChoices(now());
  const picked = parseSemesterValue(params.get('semester'));
  const semester = picked ?? parseSemesterValue(options[0]!.value)!;
  const value = semesterValue(semester);
  if (!options.some((o) => o.value === value)) {
    options.push({ value, label: semesterLabel(semester) });
  }

  const key = [...queryKeys.admin.all, 'financial-figures', value] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get(
        `/admin/financial-figures?academicYear=${semester.academicYear}&semester=${semester.semester}`,
        { schema: financialFiguresListResponseSchema },
      ),
    staleTime: 60_000,
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] }),
    ]);

  const [dialog, setDialog] = useState<{ row: FiguresRow; remark: string; error: string | null } | null>(
    null,
  );
  const flagMutation = useMutation({
    mutationFn: ({ projectId, remark }: { projectId: string; remark: string }) =>
      api.put(`/admin/projects/${projectId}/financial-figures/flag`, { remark }),
    onSuccess: async () => {
      setDialog(null);
      await refresh();
    },
    onError: (error) => setDialog((d) => d && { ...d, error: errorText(error) }),
  });
  const clearMutation = useMutation({
    mutationFn: (projectId: string) =>
      api.delete(`/admin/projects/${projectId}/financial-figures/flag`),
    onSettled: refresh,
  });

  const rows = query.data ? sortRows(query.data.items.map(toFiguresRow)) : [];
  return {
    semester: { value, label: semesterLabel(semester), options },
    setSemester: (next) =>
      setParams(next === options[0]!.value ? {} : { semester: next }, { replace: true }),
    state: query.isError
      ? { status: 'error', retry: () => void query.refetch() }
      : !query.data
        ? { status: 'loading' }
        : { status: 'ready', rows, underReview: rows.filter((r) => r.review).length },
    flag: (row) => setDialog({ row, remark: row.review?.remark ?? '', error: null }),
    clear: (row) => clearMutation.mutate(row.projectId),
    clearing: clearMutation.isPending ? (clearMutation.variables ?? null) : null,
    dialog: {
      open: dialog !== null,
      projectName: dialog ? `${dialog.row.org}: ${dialog.row.projectName}` : '',
      remark: dialog?.remark ?? '',
      setRemark: (remark) => setDialog((d) => d && { ...d, remark, error: null }),
      error: dialog?.error ?? null,
      saving: flagMutation.isPending,
      submit: () => {
        if (!dialog) return;
        const parsed = flagFinancialFiguresRequestSchema.safeParse({ remark: dialog.remark });
        if (!parsed.success) {
          setDialog({ ...dialog, error: parsed.error.issues[0]?.message ?? 'Check the remark' });
          return;
        }
        flagMutation.mutate({ projectId: dialog.row.projectId, remark: parsed.data.remark });
      },
      close: () => {
        setDialog(null);
        flagMutation.reset();
      },
    },
  };
}
