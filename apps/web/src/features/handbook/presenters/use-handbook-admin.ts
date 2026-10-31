import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  academicYearOf,
  adminHandbookResponseSchema,
  manilaDate,
  MAX_UPLOAD_BYTES,
  uploadUrlResponseSchema,
  type AdminHandbookVersion,
} from '@orghive/shared';
import { useActingAs, type ActingAsModel } from '@/features/auth/presenters/use-acting-as';
import { useAuth } from '@/features/auth/presenters/use-auth';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { putWithProgress } from '@/lib/upload-put';
import { yearLabel } from './use-handbook';

export type AdminUploadStep =
  | { status: 'idle' }
  | { status: 'uploading'; progress: number }
  | { status: 'saving' }
  | { status: 'error'; message: string };

export interface AdminEdition {
  academicYear: string;
  yearLabel: string;
  isCurrent: boolean;
  readable: boolean;
  versions: (AdminHandbookVersion & { state: 'checking' | 'refused' | 'preparing' | 'ready' })[];
  readHref: string;
}

export type HandbookAdminModel =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | {
      status: 'ready';
      editions: AdminEdition[];
      /** The years offered for an upload: next, this one and the two before. */
      years: { value: string; label: string; hasEdition: boolean }[];
      year: string;
      setYear: (year: string) => void;
      file: File | null;
      fileError: string | undefined;
      setFile: (file: File | null) => void;
      step: AdminUploadStep;
      upload: () => void;
      actingAs: ActingAsModel;
      makingCurrent: string | null;
      makeCurrent: (year: string) => void;
      currentError: string | undefined;
    };

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && (error.status === 0 || error.status < 500)) {
    return error.message.replace(/^[a-zA-Z.\d]+: /, '');
  }
  return 'Something went wrong on our side. Try again in a moment.';
}

/** "2026-2027" shifted by `by` years. */
function shiftYear(academicYear: string, by: number): string {
  const start = Number(academicYear.slice(0, 4)) + by;
  return `${start}-${start + 1}`;
}

function versionState(v: AdminHandbookVersion): AdminEdition['versions'][number]['state'] {
  if (v.scanStatus === 'pending') return 'checking';
  if (v.scanStatus !== 'clean') return 'refused';
  return v.previewStatus === 'ready' ? 'ready' : 'preparing';
}

/**
 * /admin/handbook: the ISSC account uploads a PDF per academic year (a year that has one gets
 * a new version) and chooses the current edition. Every upload and "Make current" names the
 * officer acting. Nothing here removes an edition.
 */
export function useHandbookAdmin(): HandbookAdminModel {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const actingAs = useActingAs();
  const thisYear = academicYearOf(manilaDate(new Date()));
  const [year, setYear] = useState(thisYear);
  const [file, setFileState] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string>();
  const [step, setStep] = useState<AdminUploadStep>({ status: 'idle' });
  const [makingCurrent, setMakingCurrent] = useState<string | null>(null);
  const [currentError, setCurrentError] = useState<string>();

  const query = useQuery({
    queryKey: queryKeys.handbook.admin,
    queryFn: () => api.get('/admin/handbook', { schema: adminHandbookResponseSchema }),
    // While a version is checked or rendered, look again for the result.
    refetchInterval: (q) =>
      q.state.data?.editions.some((e) =>
        e.versions.some((v) => v.scanStatus === 'pending' || (v.scanStatus === 'clean' && v.previewStatus === 'pending')),
      )
        ? 4000
        : false,
  });

  if (query.isPending) return { status: 'loading' };
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  const data = query.data;
  const issc = user?.organization?.slug;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.handbook.all });
    await queryClient.invalidateQueries({ queryKey: ['documents'] });
  }

  function setFile(next: File | null) {
    setFileError(undefined);
    if (next && (!next.name.toLowerCase().endsWith('.pdf') || next.size === 0 || next.size > MAX_UPLOAD_BYTES)) {
      setFileState(null);
      setFileError('Choose a PDF of 25 MB or less.');
      return;
    }
    setFileState(next);
  }

  async function upload() {
    if (!file) return setFileError('Choose the PDF to upload.');
    const name = actingAs.take();
    if (!name) return setStep({ status: 'error', message: 'Enter your name in “Acting as” before uploading.' });
    if (!issc) return setStep({ status: 'error', message: 'Sign in again to upload.' });
    try {
      setStep({ status: 'uploading', progress: 0 });
      const target = await api.post(
        `/organizations/${issc}/documents/upload-url`,
        { filename: file.name, contentType: 'application/pdf', sizeBytes: file.size },
        { schema: uploadUrlResponseSchema },
      );
      await putWithProgress(target.url, file, target.headers, (fraction) =>
        setStep({ status: 'uploading', progress: Math.round(fraction * 100) }),
      );
      setStep({ status: 'saving' });
      const result = await api.post(
        '/admin/handbook',
        { uploadKey: target.uploadKey, actingAs: name, academicYear: year },
        { schema: adminHandbookResponseSchema },
      );
      queryClient.setQueryData(queryKeys.handbook.admin, result);
      await refresh();
      setFileState(null);
      setStep({ status: 'idle' });
      const edition = result.editions.find((e) => e.academicYear === year);
      toast.success(
        edition && edition.versions.length > 1
          ? `New version of the ${yearLabel(year)} edition uploaded. It replaces the current file once it passes the virus scan.`
          : `${yearLabel(year)} edition uploaded. It can be read once it passes the virus scan.`,
      );
    } catch (error) {
      setStep({ status: 'error', message: errorMessage(error) });
    }
  }

  async function makeCurrent(target: string) {
    const name = actingAs.take();
    if (!name) return setCurrentError('Enter your name in “Acting as” first.');
    setCurrentError(undefined);
    setMakingCurrent(target);
    try {
      const result = await api.put(
        `/admin/handbook/${target}/current`,
        { actingAs: name },
        { schema: adminHandbookResponseSchema },
      );
      queryClient.setQueryData(queryKeys.handbook.admin, result);
      await refresh();
      toast.success(`The ${yearLabel(target)} edition is now the current Student Handbook.`);
    } catch (error) {
      setCurrentError(errorMessage(error));
    } finally {
      setMakingCurrent(null);
    }
  }

  const withEdition = new Set(data.editions.map((e) => e.academicYear));
  return {
    status: 'ready',
    editions: data.editions.map((e) => ({
      academicYear: e.academicYear,
      yearLabel: yearLabel(e.academicYear),
      isCurrent: e.isCurrent,
      readable: e.readable,
      versions: e.versions.map((v) => ({ ...v, state: versionState(v) })),
      readHref: `/handbook/${e.academicYear}`,
    })),
    years: [1, 0, -1, -2].map((by) => {
      const value = shiftYear(thisYear, by);
      return { value, label: yearLabel(value), hasEdition: withEdition.has(value) };
    }),
    year,
    setYear,
    file,
    fileError,
    setFile,
    step,
    upload: () => void upload(),
    actingAs,
    makingCurrent,
    makeCurrent: (target) => void makeCurrent(target),
    currentError,
  };
}
