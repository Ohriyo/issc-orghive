import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  CONSTITUTION_DOCUMENT_TYPE,
  academicYearOf as academicYearOfDate,
  actingAsSchema,
  contentTypeForFilename,
  documentMetadataSchema,
  documentSummarySchema,
  documentTypeListResponseSchema,
  MAX_UPLOAD_BYTES,
  organizationDetailSchema,
  projectDetailSchema,
  semesterOf,
  uploadUrlResponseSchema,
  type DocumentMetadata,
  type UploadContentType,
} from '@orghive/shared';
import { readActingAs, rememberActingAs } from '@/features/auth/presenters/use-acting-as';
import { isOwnOrganization, useAuth } from '@/features/auth/presenters/use-auth';
import {
  academicYearOf,
  SEMESTER_LABELS,
  yearOptions,
  type FilterOption,
} from '@/features/paperworks/presenters/use-paperworks';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { putWithProgress } from '@/lib/upload-put';
import type { Destination } from '@/navigation/origin';
import { useBackNavigation } from '@/navigation/use-back-navigation';
import { useUnsavedChangesGuard } from '@/navigation/use-unsaved-changes';

const FIVE_MINUTES = 5 * 60_000;

/**
 * The upload form validates with the shared schemas: who is acting for the account, once for
 * the batch, and one entry per file.
 */
export const uploadFormSchema = z.object({
  actingAs: actingAsSchema,
  documents: z.array(documentMetadataSchema).min(1, 'Add at least one file'),
});
export type UploadFormInput = z.input<typeof uploadFormSchema>;
export type UploadFormOutput = z.output<typeof uploadFormSchema>;

export type UploadStatus = 'ready' | 'uploading' | 'saving' | 'done' | 'error';

export interface UploadItem {
  file: File;
  contentType: UploadContentType;
  status: UploadStatus;
  /** 0-100 while the bytes go to storage. */
  progress: number;
  error?: string;
  /** Set once the document exists. */
  documentHref?: string;
}

/** A file refused before upload, with the reason in plain words. */
export interface RejectedFile {
  name: string;
  reason: string;
}

export const ACCEPTED_TYPES_LABEL = 'PDF, DOCX, XLSX, PPTX, JPG or PNG, up to 25 MB';

/** "bridge_design-competition 2026.pdf" -> "Bridge design competition 2026". */
export function titleFromFilename(name: string): string {
  const base = name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const title = base.charAt(0).toUpperCase() + base.slice(1);
  return title.length >= 3 ? title.slice(0, 200) : `Document ${title}`.trim();
}

/** Client-side check against the shared allow-list; the server and storage check again. */
export function checkFile(file: File): { contentType: UploadContentType } | { reason: string } {
  const contentType = contentTypeForFilename(file.name);
  if (!contentType) return { reason: `Not an allowed type. Use ${ACCEPTED_TYPES_LABEL}.` };
  if (file.size === 0) return { reason: 'The file is empty.' };
  if (file.size > MAX_UPLOAD_BYTES) return { reason: 'Larger than 25 MB.' };
  return { contentType };
}

/** "bridge, CE week" <-> ["bridge", "ce week"] for the tags field. */
export const tagsToText = (tags: string[] | undefined) => (tags ?? []).join(', ');
export const textToTags = (text: string) =>
  text
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

/** The year options, with `year` first when they lack it (a project next academic year). */
function withYear(options: FilterOption[], year: string | null): FilterOption[] {
  if (!year || options.some((o) => o.value === year)) return options;
  return [{ value: year, label: year }, ...options];
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && (error.status === 0 || error.status < 500)) return error.message;
  return 'Something went wrong on our side. Try again in a moment.';
}

export type UploadPageState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; retry: () => void }
  | { status: 'forbidden'; org: { acronym: string } }
  | ({ status: 'ready' } & UploadModel);

/** Uploading a project's extra files (spec 2C) instead of plain Paperworks. */
export interface UploadProject {
  id: string;
  name: string;
  /** `YYYY-MM-DD`: the academic year and semester each file starts with. */
  targetDate: string;
}

export interface UploadModel {
  org: { acronym: string; name: string; paperworksHref: string };
  /** Set when the files are a project's extra files. */
  project: { name: string } | null;
  options: { types: FilterOption[]; years: FilterOption[]; semesters: FilterOption[] };
  form: ReturnType<typeof useForm<UploadFormInput, unknown, UploadFormOutput>>;
  items: UploadItem[];
  rejected: RejectedFile[];
  addFiles: (files: File[]) => void;
  removeFile: (index: number) => void;
  dismissRejected: () => void;
  onSubmit: (event?: React.BaseSyntheticEvent) => Promise<void>;
  isUploading: boolean;
  /** Every file uploaded and saved. */
  allDone: boolean;
  /** Leaving with files not yet uploaded asks first. */
  leave: { asking: boolean; stay: () => void; go: () => void };
}

/**
 * Presenter for /orgs/:slug/paperworks/upload, and with `project` for a project's extra files
 * (/projects/:id/files/upload, spec 2C). For each file: an upload URL from the API, the bytes
 * PUT straight to storage (with progress), then the document is created with its details (and
 * linked to the project). Files upload one after another so a slow connection is not split.
 */
export function useUploadDocuments(
  slug: string,
  parent: Destination | null,
  project: UploadProject | null = null,
): UploadPageState {
  const queryClient = useQueryClient();
  const back = useBackNavigation(parent);
  const { user } = useAuth();
  const org = useQuery({
    queryKey: queryKeys.organizations.detail(slug),
    queryFn: () => api.get(`/organizations/${slug}`, { schema: organizationDetailSchema }),
    staleTime: FIVE_MINUTES,
  });
  const types = useQuery({
    queryKey: queryKeys.documents.types,
    queryFn: () => api.get('/document-types', { schema: documentTypeListResponseSchema }),
    staleTime: FIVE_MINUTES,
  });

  const form = useForm<UploadFormInput, unknown, UploadFormOutput>({
    resolver: zodResolver(uploadFormSchema),
    defaultValues: { actingAs: readActingAs(user?.id), documents: [] },
  });
  const fields = useFieldArray({ control: form.control, name: 'documents' });
  const [items, setItems] = useState<UploadItem[]>([]);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const update = (index: number, patch: Partial<UploadItem>) =>
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  // Files chosen but not yet saved are unsaved work.
  const guard = useUnsavedChangesGuard(items.some((item) => item.status !== 'done'));

  if (org.error instanceof ApiError && [400, 404].includes(org.error.status)) {
    return { status: 'not-found' };
  }
  if (org.isError) return { status: 'error', retry: () => void org.refetch() };
  if (!org.data) return { status: 'loading' };

  const orgId = org.data.id;
  const canUpload = isOwnOrganization(user, { id: orgId });
  if (!canUpload) {
    return { status: 'forbidden', org: { acronym: org.data.acronym } };
  }

  const addFiles = (files: File[]) => {
    const accepted: UploadItem[] = [];
    const refused: RejectedFile[] = [];
    // A project's files start in its event's academic year and semester.
    const year = project ? academicYearOfDate(project.targetDate) : academicYearOf(new Date());
    const semester = project ? semesterOf(project.targetDate) : undefined;
    for (const file of files) {
      const check = checkFile(file);
      if ('reason' in check) {
        refused.push({ name: file.name, reason: check.reason });
        continue;
      }
      accepted.push({ file, contentType: check.contentType, status: 'ready', progress: 0 });
      fields.append({
        typeId: '',
        title: titleFromFilename(file.name),
        description: '',
        academicYear: year,
        semester,
        visibility: 'private',
        tags: [],
      } satisfies DocumentMetadata);
    }
    setItems((prev) => [...prev, ...accepted]);
    setRejected(refused);
  };

  const removeFile = (index: number) => {
    fields.remove(index);
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  /** Resolves true once the file is saved (or already was). */
  async function uploadOne(
    index: number,
    item: UploadItem | undefined,
    metadata: UploadFormOutput['documents'][number],
    actingAs: string,
  ): Promise<boolean> {
    if (!item) return false;
    if (item.status === 'done') return true;
    try {
      update(index, { status: 'uploading', progress: 0, error: undefined });
      const target = await api.post(
        project
          ? `/projects/${project.id}/files/upload-url`
          : `/organizations/${slug}/documents/upload-url`,
        { filename: item.file.name, contentType: item.contentType, sizeBytes: item.file.size },
        { schema: uploadUrlResponseSchema },
      );
      await putWithProgress(target.url, item.file, target.headers, (fraction) =>
        update(index, { progress: Math.round(fraction * 100) }),
      );
      update(index, { status: 'saving' });
      const body = { ...metadata, uploadKey: target.uploadKey, actingAs };
      const documentId = project
        ? // The project's files, oldest first: the newest is this one.
          (
            await api.post(`/projects/${project.id}/files`, body, { schema: projectDetailSchema })
          ).files.at(-1)?.document.id
        : (await api.post(`/organizations/${slug}/documents`, body, { schema: documentSummarySchema }))
            .id;
      update(index, {
        status: 'done',
        progress: 100,
        documentHref: documentId ? `/documents/${documentId}` : undefined,
      });
      return true;
    } catch (error) {
      update(index, { status: 'error', error: errorMessage(error) });
      return false;
    }
  }

  const onSubmit = form.handleSubmit(async ({ actingAs, documents }) => {
    // The files as they were when the user pressed Upload; status changes land as we go.
    const snapshot = items;
    rememberActingAs(user?.id, actingAs);
    setIsUploading(true);
    let saved = 0;
    try {
      for (let i = 0; i < documents.length; i++) {
        if (await uploadOne(i, snapshot[i], documents[i]!, actingAs)) saved++;
      }
    } finally {
      setIsUploading(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['documents'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        ...(project ? [queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })] : []),
      ]);
    }
    // All saved: back where the user came from, replacing this form in the history. If
    // any failed, stay so they can be retried.
    if (saved === documents.length) {
      guard.allowNextNavigation();
      back.finish(
        saved === 1
          ? `${project ? 'Added to the project' : 'Uploaded'}. Only you see it until the virus scan passes; then it is shared as you chose.`
          : `${saved} ${project ? 'files added to the project' : 'documents uploaded'}. Each is shared as you chose once its virus scan passes.`,
      );
    }
  });

  return {
    status: 'ready',
    org: {
      acronym: org.data.acronym,
      name: org.data.name,
      paperworksHref: `/orgs/${slug}/paperworks`,
    },
    project: project && { name: project.name },
    options: {
      // The Constitution & By-laws is uploaded from the organization profile only.
      types: (types.data?.types ?? [])
        .filter((t) => t.slug !== CONSTITUTION_DOCUMENT_TYPE.slug)
        .map((t) => ({ value: t.id, label: t.name })),
      years: withYear(yearOptions(new Date()), project && academicYearOfDate(project.targetDate)),
      semesters: Object.entries(SEMESTER_LABELS).map(([value, label]) => ({ value, label })),
    },
    form,
    items,
    rejected,
    addFiles,
    removeFile,
    dismissRejected: () => setRejected([]),
    onSubmit,
    isUploading,
    allDone: items.length > 0 && items.every((item) => item.status === 'done'),
    leave: {
      asking: guard.blocker.state === 'blocked',
      stay: () => guard.blocker.reset?.(),
      go: () => guard.blocker.proceed?.(),
    },
  };
}

export type UploadProjectState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; project: UploadProject; org: { slug: string; acronym: string } };

/** /projects/:id/files/upload: the project the extra files go to (shares the project page's cache). */
export function useUploadProject(id: string): UploadProjectState {
  const query = useQuery({
    queryKey: queryKeys.projects.detail(id),
    queryFn: () => api.get(`/projects/${id}`, { schema: projectDetailSchema }),
    staleTime: 30_000,
  });
  if (query.error instanceof ApiError && [400, 403, 404].includes(query.error.status)) {
    return { status: 'not-found' };
  }
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  if (!query.data) return { status: 'loading' };
  const { organization, name, targetDate } = query.data;
  return {
    status: 'ready',
    project: { id, name, targetDate },
    org: { slug: organization.slug, acronym: organization.acronym },
  };
}
