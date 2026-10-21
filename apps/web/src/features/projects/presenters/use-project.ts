import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  isMultiFileTask,
  manilaDate,
  PROJECT_TASK_LABELS,
  PROJECT_TASK_PHASE,
  projectDetailSchema,
  TASK_DEFAULT_VISIBILITY,
  taskFileLabelSchema,
  type DocumentVisibility,
  type ProjectDetail,
  type ProjectStatus,
  type ProjectTask,
  type ProjectTaskStatus,
  type ProjectTaskType,
} from '@orghive/shared';
import { useActingAs, type ActingAsModel } from '@/features/auth/presenters/use-acting-as';
import { isOwnOrganization, useAuth } from '@/features/auth/presenters/use-auth';
import { uploadErrorMessage } from '@/features/documents/presenters/upload-version';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import {
  deadlineLabel,
  formatManilaDate,
  lockedHint,
  PROJECT_STATUS_LABEL,
  TASK_NOTES,
  type DeadlineLabel,
} from './project-format';
import { uploadTaskFile, type TaskUploadStep } from './upload-task-file';
import { useCorrectFigures, type CorrectFiguresModel } from './use-correct-figures';
import { useFiguresDraft, type FiguresModel } from './use-figures-draft';
import { usePreEventChoices, type PreEventChoicesModel } from './use-pre-event-choices';

export type TaskUploadState =
  { status: 'idle' } | TaskUploadStep | { status: 'done' } | { status: 'error'; message: string };

/** A file of a multi-file task, with its own "new version" upload. */
export interface TaskFileItem {
  label: string;
  href: string;
  title: string;
  state: 'scanning' | 'quarantined' | 'available' | 'archived';
  upload: TaskUploadState;
  /** Officers: a new version of this one file. */
  uploadVersion: ((file: File) => void) | null;
}

export interface TaskItem {
  type: ProjectTaskType;
  label: string;
  status: ProjectTaskStatus;
  /** False for the optional other pre-event documents. */
  required: boolean;
  /** When a pre-event document is due, in words (TASK_NOTES). */
  note: string | null;
  /** Communication Letters and other documents: several labelled files. */
  multiFile: boolean;
  /** A multi-file task's files the viewer may see, oldest first. */
  files: TaskFileItem[];
  /** A multi-file task's next file: its label, as the officer types it. */
  newLabel: { value: string; error: string | undefined; onChange: (value: string) => void } | null;
  /** Open tasks with a deadline: the countdown. */
  deadline: DeadlineLabel | null;
  /** "Submitted Oct 12, 2026". */
  submittedOn: string | null;
  /** Locked tasks: why, and when they open. */
  lockedHint: string | null;
  /** The task's file, when the viewer may see it. */
  file: {
    href: string;
    title: string;
    /** While the virus scan runs, or after it refused the file. */
    state: 'scanning' | 'quarantined' | 'available' | 'archived';
  } | null;
  /** Officers, on a task that is open, or submitted (to replace its file). */
  canUpload: boolean;
  visibility: DocumentVisibility;
  setVisibility: (visibility: DocumentVisibility) => void;
  upload: TaskUploadState;
  /** Before the file picker opens: false (with errors shown) when the form is not ready. */
  prepareUpload: () => boolean;
  uploadFile: (file: File) => void;
  /** The Financial Report's totals; null on other tasks. */
  figures: FiguresModel | null;
  /** Correcting the stored totals (the Financial Report, own account, semester open). */
  correction: CorrectFiguresModel | null;
}

export interface Phase {
  key: 'pre_event' | 'event' | 'post_event';
  title: string;
  /** Done: every task submitted (or, for the event, the day has come). */
  state: 'done' | 'current' | 'upcoming';
  tasks: TaskItem[];
}

export interface ProjectPageModel {
  id: string;
  name: string;
  status: ProjectStatus;
  statusLabel: string;
  eventDate: string;
  location: string;
  beneficiaries: string;
  description: string;
  org: { slug: string; acronym: string };
  phases: Phase[];
  /** Who is filing task files for the account; null when this account cannot file them. */
  actingAs: ActingAsModel | null;
  /** Which optional pre-event documents the project needs; the organization's own account. */
  choices: PreEventChoicesModel | null;
  /** Files are still being scanned: the page refreshes on its own. */
  checking: boolean;
}

export type ProjectPageState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; project: ProjectPageModel };

const PHASE_TITLES: Record<Phase['key'], string> = {
  pre_event: 'Pre-event',
  event: 'Event',
  post_event: 'Post-event',
};

/** The upload state's key: a task, or one file of a multi-file task. */
const fileKey = (type: ProjectTaskType, documentId: string) => `${type}:${documentId}`;

function fileOf(task: ProjectTask): TaskItem['file'] {
  return task.document
    ? {
        href: `/documents/${task.document.id}`,
        title: task.document.title,
        state: task.document.status,
      }
    : null;
}

function phaseState(tasks: { status: ProjectTaskStatus }[]): Phase['state'] {
  if (tasks.length > 0 && tasks.every((t) => t.status === 'submitted')) return 'done';
  return tasks.some((t) => t.status !== 'locked') ? 'current' : 'upcoming';
}

interface TaskControls {
  canManage: boolean;
  visibilityOf: (type: ProjectTaskType) => DocumentVisibility;
  setVisibility: (type: ProjectTaskType, visibility: DocumentVisibility) => void;
  /** By task type, or by `fileKey` for one file of a multi-file task. */
  uploadOf: (key: string) => TaskUploadState;
  prepareUpload: (type: ProjectTaskType) => boolean;
  uploadFile: (type: ProjectTaskType, file: File) => void;
  /** A new version of one file of a multi-file task. */
  uploadVersion: (type: ProjectTaskType, documentId: string, file: File) => void;
  /** The label typed for a multi-file task's next file. */
  labelOf: (type: ProjectTaskType) => { value: string; error: string | undefined };
  setLabel: (type: ProjectTaskType, value: string) => void;
  /** The Financial Report's totals, for its card. */
  figures: FiguresModel;
  correction?: CorrectFiguresModel | null;
}

/** Shapes the API's project for the stepper. Pure apart from the callbacks it is given. */
export function toProjectPage(
  project: ProjectDetail,
  controls: TaskControls,
  now: Date,
): Omit<ProjectPageModel, 'actingAs' | 'choices'> {
  const blocked = project.status === 'blocked';
  const canUploadTo = (task: ProjectTask) =>
    controls.canManage && !blocked && task.status !== 'locked';
  const item = (task: ProjectTask): TaskItem => ({
    type: task.type,
    label: PROJECT_TASK_LABELS[task.type],
    status: task.status,
    required: task.required,
    note: TASK_NOTES[task.type] ?? null,
    multiFile: isMultiFileTask(task.type),
    files: task.files.map((f) => ({
      label: f.label,
      href: `/documents/${f.document.id}`,
      title: f.document.title,
      state: f.document.status,
      upload: controls.uploadOf(fileKey(task.type, f.document.id)),
      uploadVersion: canUploadTo(task)
        ? (file) => controls.uploadVersion(task.type, f.document.id, file)
        : null,
    })),
    newLabel:
      isMultiFileTask(task.type) && canUploadTo(task)
        ? {
            ...controls.labelOf(task.type),
            onChange: (value) => controls.setLabel(task.type, value),
          }
        : null,
    deadline: task.status === 'open' && task.dueAt ? deadlineLabel(task.dueAt, now) : null,
    submittedOn: task.submittedAt ? `Submitted ${formatManilaDate(task.submittedAt)}` : null,
    lockedHint: task.status === 'locked' ? lockedHint(task.type, project.targetDate) : null,
    file: fileOf(task),
    canUpload: canUploadTo(task),
    visibility: controls.visibilityOf(task.type),
    setVisibility: (visibility) => controls.setVisibility(task.type, visibility),
    upload: controls.uploadOf(task.type),
    prepareUpload: () => controls.prepareUpload(task.type),
    uploadFile: (file) => controls.uploadFile(task.type, file),
    figures: task.type === 'FINANCIAL_REPORT' ? controls.figures : null,
    correction: task.type === 'FINANCIAL_REPORT' ? (controls.correction ?? null) : null,
  });
  const pre = project.tasks.filter((t) => PROJECT_TASK_PHASE[t.type] === 'pre_event').map(item);
  const post = project.tasks.filter((t) => PROJECT_TASK_PHASE[t.type] === 'post_event').map(item);
  const eventReached = manilaDate(now) >= project.targetDate;

  return {
    id: project.id,
    name: project.name,
    status: project.status,
    statusLabel: PROJECT_STATUS_LABEL[project.status],
    eventDate: formatManilaDate(project.targetDate),
    location: project.location,
    beneficiaries: project.beneficiaries,
    description: project.description,
    org: { slug: project.organization.slug, acronym: project.organization.acronym },
    phases: [
      { key: 'pre_event', title: PHASE_TITLES.pre_event, state: phaseState(pre), tasks: pre },
      {
        key: 'event',
        title: PHASE_TITLES.event,
        state: eventReached ? 'done' : 'upcoming',
        tasks: [],
      },
      { key: 'post_event', title: PHASE_TITLES.post_event, state: phaseState(post), tasks: post },
    ],
    checking: project.tasks.some(isChecking),
  };
}

/** A task with a file still being scanned: the page checks again until it settles. */
function isChecking(task: ProjectTask): boolean {
  return (
    task.document?.status === 'scanning' || task.files.some((f) => f.document.status === 'scanning')
  );
}

/** Presenter for /projects/:id: the checklist, and task uploads for the organization's officers. */
export function useProject(id: string, now: () => Date = () => new Date()): ProjectPageState {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [visibility, setVisibility] = useState<
    Partial<Record<ProjectTaskType, DocumentVisibility>>
  >({});
  const [uploads, setUploads] = useState<Record<string, TaskUploadState>>({});
  const [labels, setLabels] = useState<
    Partial<Record<ProjectTaskType, { value: string; error: string | undefined }>>
  >({});
  const actingAs = useActingAs();
  const figuresDraft = useFiguresDraft();
  const correction = useCorrectFigures(id);
  const query = useQuery({
    queryKey: queryKeys.projects.detail(id),
    queryFn: () => api.get(`/projects/${id}`, { schema: projectDetailSchema }),
    // While a task's file is being scanned, check again until it settles.
    refetchInterval: (q) => (q.state.data?.tasks.some(isChecking) ? 3000 : false),
    staleTime: 30_000,
  });
  const choices = usePreEventChoices(query.data);

  if (query.error instanceof ApiError && [400, 403, 404].includes(query.error.status)) {
    return { status: 'not-found' };
  }
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  if (!query.data) return { status: 'loading' };

  const project = query.data;
  const canManage = isOwnOrganization(user, { slug: project.organization.slug });

  const setUpload = (key: string, state: TaskUploadState) =>
    setUploads((all) => ({ ...all, [key]: state }));
  const labelOf = (type: ProjectTaskType) => labels[type] ?? { value: '', error: undefined };
  /** A multi-file task's next file needs a label first: checked before the file picker. */
  const takeLabel = (type: ProjectTaskType): string | null => {
    const parsed = taskFileLabelSchema.safeParse(labelOf(type).value);
    if (parsed.success) return parsed.data;
    setLabels((all) => ({
      ...all,
      [type]: { value: labelOf(type).value, error: parsed.error.issues[0]?.message },
    }));
    return null;
  };
  const visibilityOf = (type: ProjectTaskType) => {
    const task = project.tasks.find((t) => t.type === type);
    return visibility[type] ?? task?.document?.visibility ?? TASK_DEFAULT_VISIBILITY[type];
  };

  const takeFigures = () => figuresDraft.take(project.financialFigures);

  async function uploadFile(type: ProjectTaskType, file: File, documentId?: string) {
    const name = actingAs.take();
    if (!name) return;
    const figures = type === 'FINANCIAL_REPORT' ? takeFigures() : undefined;
    if (figures === null) return;
    const multi = isMultiFileTask(type);
    const label = multi && !documentId ? takeLabel(type) : undefined;
    if (label === null) return;
    const key = documentId ? fileKey(type, documentId) : type;
    try {
      const updated = await uploadTaskFile(
        id,
        type,
        file,
        visibilityOf(type),
        name,
        (step) => setUpload(key, step),
        figures,
        multi ? { label, documentId } : undefined,
      );
      queryClient.setQueryData(queryKeys.projects.detail(id), updated);
      setUpload(key, { status: 'done' });
      if (label) setLabels((all) => ({ ...all, [type]: { value: '', error: undefined } }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.all }),
        queryClient.invalidateQueries({ queryKey: ['documents'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ]);
    } catch (error) {
      setUpload(key, { status: 'error', message: uploadErrorMessage(error) });
    }
  }

  return {
    status: 'ready',
    project: {
      ...toProjectPage(
        project,
        {
          canManage,
          visibilityOf,
          setVisibility: (type, next) => setVisibility((all) => ({ ...all, [type]: next })),
          uploadOf: (key) => uploads[key] ?? { status: 'idle' },
          // The Financial Report's totals and a new file's label are checked before a file
          // is picked.
          prepareUpload: (type) =>
            type === 'FINANCIAL_REPORT'
              ? takeFigures() !== null
              : !isMultiFileTask(type) || takeLabel(type) !== null,
          uploadFile: (type, file) => void uploadFile(type, file),
          uploadVersion: (type, documentId, file) => void uploadFile(type, file, documentId),
          labelOf,
          setLabel: (type, value) =>
            setLabels((all) => ({ ...all, [type]: { value, error: undefined } })),
          figures: figuresDraft.model(project.financialFigures, canManage),
          correction: correction.model(
            project.financialFigures,
            actingAs,
            { acronym: project.organization.acronym, canManage },
            now(),
          ),
        },
        now(),
      ),
      actingAs: canManage ? actingAs : null,
      choices: canManage ? choices : null,
    },
  };
}
