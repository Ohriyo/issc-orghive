import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import {
  academicYearOf,
  complianceOverviewSchema,
  manilaDate,
  SEMESTER_LABELS,
  semesterOf,
  SEMESTERS,
  type ComplianceOverview,
  type Semester,
} from '@orghive/shared';
import {
  semesterOptions,
  type SemesterOption,
} from '@/features/reports/presenters/use-semestral-reports';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import {
  csvFilename,
  overviewCsv,
  SORT_OPTIONS,
  sortRows,
  toRowView,
  totalsOf,
  type ComplianceRowView,
  type OverviewSort,
  type OverviewTotals,
} from './compliance-format';

export type ComplianceOverviewModel = {
  semester: { value: string; options: SemesterOption[]; set: (value: string) => void };
  sort: { value: OverviewSort; options: typeof SORT_OPTIONS; set: (value: OverviewSort) => void };
} & (
  | { status: 'loading' }
  | { status: 'forbidden' }
  | { status: 'error'; retry: () => void }
  | {
      status: 'ready';
      /** "CSC-CEA: the SBOs of your college", "ISSC: every CSC and SBO". */
      scope: string;
      rows: ComplianceRowView[];
      totals: OverviewTotals;
      /** Downloads what is on screen, in its order, as CSV. */
      exportCsv: () => void;
    }
);

interface ChosenSemester {
  academicYear: string;
  semester: Semester;
  /** `2026-2027:first`. */
  value: string;
}

function semesterFrom(value: string | null): ChosenSemester | null {
  const match = /^(\d{4})-(\d{4}):([a-z]+)$/.exec(value ?? '');
  if (!match || Number(match[2]) !== Number(match[1]) + 1) return null;
  if (!(SEMESTERS as readonly string[]).includes(match[3]!)) return null;
  return {
    academicYear: `${match[1]}-${match[2]}`,
    semester: match[3] as Semester,
    value: value!,
  };
}

/** `?semester=2026-2027:first` → its parts; missing or malformed gives `current`. */
export function parseSemester(value: string | null, current: string): ChosenSemester {
  return semesterFrom(value) ?? semesterFrom(current)!;
}

/** Saves text as a file in the browser. A BOM first, so Excel reads the CSV as UTF-8. */
function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function scopeText(overview: ComplianceOverview): string {
  return overview.scope.type === 'CSC'
    ? `${overview.scope.acronym}: the SBOs of your college`
    : `${overview.scope.acronym}: every CSC and SBO`;
}

/**
 * /dashboard/compliance: read-only, from the F11 project data. The server decides whose
 * organizations the user sees (CSC: its college's SBOs; ISSC and admins: every CSC and SBO).
 */
export function useComplianceOverview(now = new Date()): ComplianceOverviewModel {
  const [params, setParams] = useSearchParams();
  const today = manilaDate(now);
  const current = `${academicYearOf(today)}:${semesterOf(today)}`;
  const chosen = parseSemester(params.get('semester'), current);
  const sort: OverviewSort = params.get('sort') === 'name' ? 'name' : 'overdue';

  const options = semesterOptions(today);
  const setParam = (name: string, value: string, fallback: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === fallback) next.delete(name);
        else next.set(name, value);
        return next;
      },
      { replace: true },
    );

  const query = useQuery({
    queryKey: queryKeys.projects.overview(chosen.academicYear, chosen.semester),
    queryFn: () =>
      api.get(
        `/compliance/overview?${new URLSearchParams({
          academicYear: chosen.academicYear,
          semester: chosen.semester,
        }).toString()}`,
        { schema: complianceOverviewSchema },
      ),
    staleTime: 60_000,
    // Only a lost connection or a server error can go better on a retry.
    retry: (count, error) =>
      error instanceof ApiError && (error.status === 0 || error.status >= 500) && count < 2,
  });

  const base = {
    semester: {
      value: chosen.value,
      options: options.some((o) => o.value === chosen.value)
        ? options
        : [
            ...options,
            {
              value: chosen.value,
              label: `${SEMESTER_LABELS[chosen.semester]} ${chosen.academicYear}`,
            },
          ],
      set: (value: string) => setParam('semester', value, current),
    },
    sort: {
      value: sort,
      options: SORT_OPTIONS,
      set: (value: OverviewSort) => setParam('sort', value, 'overdue'),
    },
  };

  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 403) {
      return { ...base, status: 'forbidden' };
    }
    return { ...base, status: 'error', retry: () => void query.refetch() };
  }
  if (!query.data) return { ...base, status: 'loading' };

  const overview = query.data;
  const sorted = sortRows(overview.organizations, sort);
  return {
    ...base,
    status: 'ready',
    scope: scopeText(overview),
    rows: sorted.map((row) => toRowView(row, now)),
    totals: totalsOf(sorted),
    exportCsv: () => download(csvFilename(overview), overviewCsv(sorted)),
  };
}
