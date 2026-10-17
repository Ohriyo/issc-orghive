import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  academicYearOf,
  downloadUrlResponseSchema,
  manilaDate,
  SEMESTER_LABELS,
  SEMESTERS,
  semesterOf,
  semesterRange,
  semestralReportListResponseSchema,
  semestralReportSchema,
  type ReportStatus,
  type Semester,
  type SemestralReport,
} from '@orghive/shared';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export interface SemesterOption {
  /** "2026-2027:first" */
  value: string;
  /** "1st semester 2026-2027" */
  label: string;
}

/**
 * The semesters an officer can report on: those that have started, this academic year and
 * the two before, newest first. Pure, so the rules are tested with any date.
 */
export function semesterOptions(today: string): SemesterOption[] {
  const currentStart = Number(academicYearOf(today).slice(0, 4));
  const options: SemesterOption[] = [];
  for (let start = currentStart; start > currentStart - 3; start--) {
    const year = `${start}-${start + 1}`;
    for (const semester of [...SEMESTERS].reverse()) {
      if (semesterRange(year, semester).start > today) continue;
      options.push({ value: `${year}:${semester}`, label: `${SEMESTER_LABELS[semester]} ${year}` });
    }
  }
  return options;
}

function parseOption(value: string): { academicYear: string; semester: Semester } {
  const [academicYear = '', semester = 'first'] = value.split(':');
  return { academicYear, semester: semester as Semester };
}

const STATUS_TEXT: Record<ReportStatus, string> = {
  queued: 'Waiting to start…',
  generating: 'Generating',
  ready: 'Ready',
  failed: 'Failed',
};

const dateTime = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Manila',
});

export interface ReportItem {
  id: string;
  /** "1st semester 2026-2027" */
  label: string;
  status: ReportStatus;
  statusText: string;
  progress: number;
  /** "Requested Oct 17, 2026, 9:30 PM by Juan Dela Cruz" */
  requested: string;
  error: string | null;
  /** Ready: the document page and a direct download. */
  documentHref: string | null;
  download: (() => void) | null;
}

export type SemestralReportsModel =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | {
      status: 'ready';
      items: ReportItem[];
      options: SemesterOption[];
      dialog: {
        open: boolean;
        setOpen: (open: boolean) => void;
        selected: string;
        select: (value: string) => void;
        submit: () => void;
        submitting: boolean;
        error: string | undefined;
      };
      /** A download that could not start. */
      downloadError: string | undefined;
    };

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && (error.status === 0 || error.status < 500)) return error.message;
  return 'Something went wrong on our side. Try again in a moment.';
}

function toItem(report: SemestralReport, download: (r: SemestralReport) => void): ReportItem {
  const doc = report.status === 'ready' ? report.document : null;
  return {
    id: report.id,
    label: `${SEMESTER_LABELS[report.semester]} ${report.academicYear}`,
    status: report.status,
    statusText: STATUS_TEXT[report.status],
    progress: report.progress,
    requested: `Requested ${dateTime.format(new Date(report.createdAt))} by ${report.requestedBy.name}`,
    error: report.error,
    documentHref: doc ? `/documents/${doc.id}` : null,
    download: doc ? () => download(report) : null,
  };
}

/**
 * The officer dashboard's Semestral End Report panel: pick a semester, ask for the report,
 * watch it being made (checked every 2 s while one runs), then download it.
 */
export function useSemestralReports(
  /** Null until an organization the user is an officer of is selected. */
  slug: string | null,
  now: () => Date = () => new Date(),
): SemestralReportsModel | null {
  const queryClient = useQueryClient();
  const today = manilaDate(now());
  const options = semesterOptions(today);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(() => `${academicYearOf(today)}:${semesterOf(today)}`);
  const [error, setError] = useState<string>();
  const [downloadError, setDownloadError] = useState<string>();

  const query = useQuery({
    queryKey: queryKeys.reports.list(slug ?? ''),
    queryFn: () =>
      api.get(`/organizations/${slug}/semestral-reports`, {
        schema: semestralReportListResponseSchema,
      }),
    enabled: !!slug,
    staleTime: 60_000,
    refetchInterval: (q) =>
      q.state.data?.items.some((r) => r.status === 'queued' || r.status === 'generating')
        ? 2000
        : false,
  });
  const request = useMutation({
    mutationFn: (value: string) =>
      api.post(`/organizations/${slug}/semestral-reports`, parseOption(value), {
        schema: semestralReportSchema,
      }),
  });

  if (!slug) return null;
  const orgSlug = slug;
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  if (!query.data) return { status: 'loading' };

  async function download(report: SemestralReport) {
    setDownloadError(undefined);
    try {
      const doc = report.document!;
      const link = await api.get(`/documents/${doc.id}/versions/${doc.versionId}/download-url`, {
        schema: downloadUrlResponseSchema,
      });
      window.location.assign(link.url);
    } catch (err) {
      setDownloadError(errorMessage(err));
    }
  }

  async function submit() {
    setError(undefined);
    try {
      await request.mutateAsync(selected);
      setOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.reports.list(orgSlug) }),
        queryClient.invalidateQueries({ queryKey: ['documents'] }),
      ]);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return {
    status: 'ready',
    items: query.data.items.map((r) => toItem(r, (report) => void download(report))),
    options,
    dialog: {
      open,
      setOpen: (next) => {
        setOpen(next);
        if (next) setError(undefined);
      },
      selected: options.some((o) => o.value === selected) ? selected : (options[0]?.value ?? ''),
      select: setSelected,
      submit: () => void submit(),
      submitting: request.isPending,
      error,
    },
    downloadError,
  };
}
