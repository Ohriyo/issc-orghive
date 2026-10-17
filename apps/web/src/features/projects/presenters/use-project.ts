import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  manilaDate,
  PROJECT_TASK_LABELS,
  PROJECT_TASK_PHASE,
  projectDetailSchema,
  TASK_DEFAULT_VISIBILITY,
  type DocumentVisibility,
  type ProjectDetail,
  type ProjectStatus,
  type ProjectTask,
  type ProjectTaskStatus,
  type ProjectTaskType,
} from '@orghive/shared';
import { useAuth } from '@/features/auth/presenters/use-auth';
import { uploadErrorMessage } from '@/features/documents/presenters/upload-version';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import {
  deadlineLabel,
  formatManilaDate,
  lockedHint,
  PROJECT_STATUS_LABEL,
  type DeadlineLabel,
} from './project-format';
import { uploadTaskFile, type TaskUploadStep } from './upload-task-file';

export type TaskUploadState =
  { status: 'idle' } | TaskUploadStep | { status: 'done' } | { status: 'error'; message: string };

export interface TaskItem {
  type: ProjectTaskType;
  label: string;
  status: ProjectTaskStatus;
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
  uploadFile: (file: File) => void;
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
  uploadOf: (type: ProjectTaskType) => TaskUploadState;
  uploadFile: (type: ProjectTaskType, file: File) => void;
}

/** Shapes the API's project for the stepper. Pure apart from the callbacks it is given. */
export function toProjectPage(
  project: ProjectDetail,
  controls: TaskControls,
  now: Date,
): ProjectPageModel {
  const blocked = project.status === 'blocked';
  const item = (task: ProjectTask): TaskItem => ({
    type: task.type,
    label: PROJECT_TASK_LABELS[task.type],
    status: task.status,
    deadline: task.status === 'open' && task.dueAt ? deadlineLabel(task.dueAt, now) : null,
    submittedOn: task.submittedAt ? `Submitted ${formatManilaDate(task.submittedAt)}` : null,
    lockedHint: task.status === 'locked' ? lockedHint(task.type, project.targetDate) : null,
    file: fileOf(task),
    canUpload: controls.canManage && !blocked && task.status !== 'locked',
    visibility: controls.visibilityOf(task.type),
    setVisibility: (visibility) => controls.setVisibility(task.type, visibility),
    upload: controls.uploadOf(task.type),
    uploadFile: (file) => controls.uploadFile(task.type, file),
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
    checking: project.tasks.some((t) => t.document?.status === 'scanning'),
  };
}

/** Presenter for /projects/:id: the checklist, and task uploads for the organization's officers. */
export function useProject(id: string, now: () => Date = () => new Date()): ProjectPageState {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [visibility, setVisibility] = useState<
    Partial<Record<ProjectTaskType, DocumentVisibility>>
  >({});
  const [uploads, setUploads] = useState<Partial<Record<ProjectTaskType, TaskUploadState>>>({});
  const query = useQuery({
    queryKey: queryKeys.projects.detail(id),
    queryFn: () => api.get(`/projects/${id}`, { schema: projectDetailSchema }),
    // While a task's file is being scanned, check again until it settles.
    refetchInterval: (q) =>
      q.state.data?.tasks.some((t) => t.document?.status === 'scanning') ? 3000 : false,
    staleTime: 30_000,
  });

  if (query.error instanceof ApiError && [400, 403, 404].includes(query.error.status)) {
    return { status: 'not-found' };
  }
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  if (!query.data) return { status: 'loading' };

  const project = query.data;
  const canManage =
    !!user?.memberships.some(
      (m) => m.orgSlug === project.organization.slug && m.role === 'officer',
    ) || !!user?.roles.some((r) => r.role === 'admin');

  const setUpload = (type: ProjectTaskType, state: TaskUploadState) =>
    setUploads((all) => ({ ...all, [type]: state }));
  const visibilityOf = (type: ProjectTaskType) => {
    const task = project.tasks.find((t) => t.type === type);
    return visibility[type] ?? task?.document?.visibility ?? TASK_DEFAULT_VISIBILITY[type];
  };

  async function uploadFile(type: ProjectTaskType, file: File) {
    try {
      const updated = await uploadTaskFile(id, type, file, visibilityOf(type), (step) =>
        setUpload(type, step),
      );
      queryClient.setQueryData(queryKeys.projects.detail(id), updated);
      setUpload(type, { status: 'done' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.all }),
        queryClient.invalidateQueries({ queryKey: ['documents'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ]);
    } catch (error) {
      setUpload(type, { status: 'error', message: uploadErrorMessage(error) });
    }
  }

  return {
    status: 'ready',
    project: toProjectPage(
      project,
      {
        canManage,
        visibilityOf,
        setVisibility: (type, next) => setVisibility((all) => ({ ...all, [type]: next })),
        uploadOf: (type) => uploads[type] ?? { status: 'idle' },
        uploadFile: (type, file) => void uploadFile(type, file),
      },
      now(),
    ),
  };
}
