import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  isCheckedTask,
  isMultiFileTask,
  manilaDate,
  PROJECT_TASK_LABELS,
  PROJECT_TASK_PHASE,
  projectDetailSchema,
  TASK_CODE_SUFFIXES,
  TASK_DEFAULT_VISIBILITY,
  taskCodeSchema,
  taskFileLabelSchema,
  taskUploadAcceptFor,
  type DocumentVisibility,
  type ProjectDetail,
  type ProjectStatus,
  type ProjectTask,
  type ProjectTaskStatus,
  type ProjectTaskType,
  type TaskFileIntegrity,
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
import { downloadTaskTemplate, type TemplateFormat } from './download-template';
import { integrityStatus, type IntegrityStatus } from './task-integrity';
import {
  useTaskFileDecision,
  type DecisionActions,
  type DecisionTarget,
  type TaskFileDecisionModel,
} from './use-task-file-decision';
import { taskFileTypesLabel, uploadTaskFile, type TaskUploadStep } from './upload-task-file';
import { useCorrectFigures, type CorrectFiguresModel } from './use-correct-figures';
import { useFiguresDraft, type FiguresModel } from './use-figures-draft';
import { usePreEventChoices, type PreEventChoicesModel } from './use-pre-event-choices';

export type TaskUploadState =
  { status: 'idle' } | TaskUploadStep | { status: 'done' } | { status: 'error'; message: string };

/** "Download template" on a checked task (spec section 6): Word to fill in, or a PDF. */
export interface TemplateModel {
  download: (format: TemplateFormat) => void;
  /** The format being prepared. */
  busy: TemplateFormat | null;
  error: string | null;
}

/** A text field's value, its error, and its change handler. */
export interface FieldModel {
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}

/** A file of a multi-file task, with its own "new version" upload. */
export interface TaskFileItem {
  label: string;
  href: string;
  title: string;
  state: 'scanning' | 'quarantined' | 'available' | 'archived';
  /** Its integrity checks; null for unchecked tasks and viewers outside the organization. */
  integrity: IntegrityStatus | null;
  upload: TaskUploadState;
  /** Officers: a new version of this one file. */
  uploadVersion: ((file: File) => void) | null;
  /** Officers, on a checked task: this letter's own template, for its new version. */
  template: TemplateModel | null;
  /** Governing bodies: "Clear warning" and "Flag invalid" (spec section 6). */
  decide: DecisionActions | null;
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
  newLabel: FieldModel | null;
  /** Checked tasks (spec section 6): a PDF of the signed template, its QR code read. */
  checked: boolean;
  /** The file picker's `accept`. */
  accept: string;
  /** "PDF, JPG or PNG, up to 25 MB". */
  fileTypes: string;
  /** Officers, on a checked task: its pre-filled template with the QR code. */
  template: TemplateModel | null;
  /** Officers, on a checked task: the short code under a damaged QR, typed (optional). */
  taskCode: FieldModel | null;
  /** A checked task filed as Private: it completes the task but is not ranked. */
  rankingNote: string | null;
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
    /** Its integrity checks; null for unchecked tasks and viewers outside the organization. */
    integrity: IntegrityStatus | null;
    /** Governing bodies: "Clear warning" and "Flag invalid" (spec section 6). */
    decide: DecisionActions | null;
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
  /** Extra files outside the checklist (spec 2C) the viewer may see, oldest first. */
  files: Omit<NonNullable<TaskItem['file']>, 'integrity' | 'decide'>[];
  /** The organization's own account: where it adds extra files. */
  addFilesHref: string | null;
  /** Files are still being scanned: the page refreshes on its own. */
  checking: boolean;
  /** Governing bodies of the organization: the clear/flag dialog. */
  decision: TaskFileDecisionModel | null;
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

function fileOf(
  task: ProjectTask,
  decide: DecisionActions | null,
  forOwner: boolean,
): TaskItem['file'] {
  return task.document
    ? {
        href: `/documents/${task.document.id}`,
        title: task.document.title,
        state: task.document.status,
        integrity: integrityStatus(task.document.integrity, forOwner),
        decide,
      }
    : null;
}

export const PRIVATE_RANKING_NOTE =
  'Private files complete the task, but only Public and Governing bodies files count for the leaderboard.';

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
  /** A checked task's template; `documentId` for one letter's own. */
  templateOf: (type: ProjectTaskType, documentId?: string) => TemplateModel;
  /** The short code typed for a task whose QR is damaged. */
  codeOf: (type: ProjectTaskType) => { value: string; error: string | undefined };
  setCode: (type: ProjectTaskType, value: string) => void;
  /** The Financial Report's totals, for its card. */
  figures: FiguresModel;
  correction?: CorrectFiguresModel | null;
  /** Governing bodies: a file's clear/flag actions. */
  decideOn?: (target: DecisionTarget, integrity: TaskFileIntegrity | null) => DecisionActions;
}

/** Shapes the API's project for the stepper. Pure apart from the callbacks it is given. */
export function toProjectPage(
  project: ProjectDetail,
  controls: TaskControls,
  now: Date,
): Omit<ProjectPageModel, 'actingAs' | 'choices' | 'decision'> {
  const blocked = project.status === 'blocked';
  const canUploadTo = (task: ProjectTask) =>
    controls.canManage && !blocked && task.status !== 'locked';
  /** A governing body's actions on one task file it may see. */
  const decideOn = (doc: { id: string; integrity: TaskFileIntegrity | null }, what: string) =>
    controls.decideOn && doc.integrity
      ? controls.decideOn(
          {
            documentId: doc.id,
            name: `${what}, ${project.name} (${project.organization.acronym})`,
            reasons: doc.integrity.reasons,
          },
          doc.integrity,
        )
      : null;
  const item = (task: ProjectTask): TaskItem => {
    const checked = isCheckedTask(task.type);
    const canUpload = canUploadTo(task);
    const visibility = controls.visibilityOf(task.type);
    return {
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
        integrity: integrityStatus(f.document.integrity, controls.canManage),
        decide: decideOn(f.document, `${f.label} (${PROJECT_TASK_LABELS[task.type]})`),
        upload: controls.uploadOf(fileKey(task.type, f.document.id)),
        uploadVersion: canUpload
          ? (file) => controls.uploadVersion(task.type, f.document.id, file)
          : null,
        template: canUpload && checked ? controls.templateOf(task.type, f.document.id) : null,
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
      checked,
      accept: taskUploadAcceptFor(task.type),
      fileTypes: taskFileTypesLabel(task.type),
      template: canUpload && checked ? controls.templateOf(task.type) : null,
      taskCode:
        canUpload && checked
          ? {
              ...controls.codeOf(task.type),
              onChange: (value) => controls.setCode(task.type, value),
            }
          : null,
      rankingNote: checked && visibility === 'private' ? PRIVATE_RANKING_NOTE : null,
      file: fileOf(
        task,
        task.document ? decideOn(task.document, PROJECT_TASK_LABELS[task.type]) : null,
        controls.canManage,
      ),
      canUpload,
      visibility,
      setVisibility: (next) => controls.setVisibility(task.type, next),
      upload: controls.uploadOf(task.type),
      prepareUpload: () => controls.prepareUpload(task.type),
      uploadFile: (file) => controls.uploadFile(task.type, file),
      figures: task.type === 'FINANCIAL_REPORT' ? controls.figures : null,
      correction: task.type === 'FINANCIAL_REPORT' ? (controls.correction ?? null) : null,
    };
  };
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
    files: project.files.map((f) => ({
      href: `/documents/${f.document.id}`,
      title: f.document.title,
      state: f.document.status,
    })),
    addFilesHref: controls.canManage ? `/projects/${project.id}/files/upload` : null,
    checking: isProjectChecking(project),
  };
}

/** A file still being scanned or checked. */
const pending = (doc: ProjectTask['files'][number]['document']) =>
  doc.status === 'scanning' || doc.integrity?.state === 'checking';

/** A task with a file still being scanned or checked: the page checks again until it settles. */
function isChecking(task: ProjectTask): boolean {
  return (
    (task.document !== null && pending(task.document)) ||
    task.files.some((f) => pending(f.document))
  );
}

/** Any of the project's files (checklist or extra) still being scanned. */
function isProjectChecking(project: ProjectDetail): boolean {
  return (
    project.tasks.some(isChecking) || project.files.some((f) => f.document.status === 'scanning')
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
  const [codes, setCodes] = useState<
    Partial<Record<ProjectTaskType, { value: string; error: string | undefined }>>
  >({});
  const [templates, setTemplates] = useState<
    Record<string, { busy: TemplateFormat | null; error: string | null }>
  >({});
  const actingAs = useActingAs();
  const figuresDraft = useFiguresDraft();
  const correction = useCorrectFigures(id);
  const query = useQuery({
    queryKey: queryKeys.projects.detail(id),
    queryFn: () => api.get(`/projects/${id}`, { schema: projectDetailSchema }),
    // While a task's file is being scanned, check again until it settles.
    refetchInterval: (q) => (q.state.data && isProjectChecking(q.state.data) ? 3000 : false),
    staleTime: 30_000,
  });
  const choices = usePreEventChoices(query.data);
  const decision = useTaskFileDecision();

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

  const codeOf = (type: ProjectTaskType) => codes[type] ?? { value: '', error: undefined };
  /**
   * The short code typed under a damaged QR: undefined when left empty, null (with the error
   * shown) when it is not a code of this task.
   */
  const takeCode = (type: ProjectTaskType): string | undefined | null => {
    const { value } = codeOf(type);
    if (!isCheckedTask(type) || value.trim() === '') return undefined;
    const parsed = taskCodeSchema.safeParse(value);
    const error = !parsed.success
      ? parsed.error.issues[0]?.message
      : !parsed.data.endsWith(`-${TASK_CODE_SUFFIXES[type]}`)
        ? `This code is for another task. The ${PROJECT_TASK_LABELS[type]}’s ends in -${TASK_CODE_SUFFIXES[type]}.`
        : undefined;
    if (parsed.success && !error) return parsed.data;
    setCodes((all) => ({ ...all, [type]: { value, error } }));
    return null;
  };

  async function downloadTemplate(
    type: ProjectTaskType,
    format: TemplateFormat,
    documentId?: string,
  ) {
    const key = documentId ? fileKey(type, documentId) : type;
    // A letter's template is named after it: the label typed for a new one, or the file's own.
    let label: string | undefined;
    if (isMultiFileTask(type)) {
      const existing = documentId
        ? project.tasks
            .find((t) => t.type === type)
            ?.files.find((f) => f.document.id === documentId)
        : undefined;
      label = existing ? existing.label : (takeLabel(type) ?? undefined);
      if (!label) return;
    }
    setTemplates((all) => ({ ...all, [key]: { busy: format, error: null } }));
    try {
      await downloadTaskTemplate(id, type, { format, label }, project.organization.acronym);
      setTemplates((all) => ({ ...all, [key]: { busy: null, error: null } }));
    } catch (error) {
      const message =
        error instanceof ApiError && error.status !== 0 && error.status < 500
          ? error.message
          : 'The template could not be prepared. Try again in a moment.';
      setTemplates((all) => ({ ...all, [key]: { busy: null, error: message } }));
    }
  }

  async function uploadFile(type: ProjectTaskType, file: File, documentId?: string) {
    const name = actingAs.take();
    if (!name) return;
    const figures = type === 'FINANCIAL_REPORT' ? takeFigures() : undefined;
    if (figures === null) return;
    const multi = isMultiFileTask(type);
    const label = multi && !documentId ? takeLabel(type) : undefined;
    if (label === null) return;
    const taskCode = takeCode(type);
    if (taskCode === null) return;
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
        multi || taskCode ? { label, documentId, taskCode } : undefined,
      );
      queryClient.setQueryData(queryKeys.projects.detail(id), updated);
      setUpload(key, { status: 'done' });
      if (label) setLabels((all) => ({ ...all, [type]: { value: '', error: undefined } }));
      if (taskCode) setCodes((all) => ({ ...all, [type]: { value: '', error: undefined } }));
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
          // The Financial Report's totals, a new file's label and a typed code are checked
          // before a file is picked.
          prepareUpload: (type) =>
            takeCode(type) !== null &&
            (type === 'FINANCIAL_REPORT'
              ? takeFigures() !== null
              : !isMultiFileTask(type) || takeLabel(type) !== null),
          uploadFile: (type, file) => void uploadFile(type, file),
          uploadVersion: (type, documentId, file) => void uploadFile(type, file, documentId),
          labelOf,
          setLabel: (type, value) =>
            setLabels((all) => ({ ...all, [type]: { value, error: undefined } })),
          templateOf: (type, documentId) => ({
            ...(templates[documentId ? fileKey(type, documentId) : type] ?? {
              busy: null,
              error: null,
            }),
            download: (format) => void downloadTemplate(type, format, documentId),
          }),
          codeOf,
          setCode: (type, value) =>
            setCodes((all) => ({ ...all, [type]: { value, error: undefined } })),
          figures: figuresDraft.model(project.financialFigures, canManage),
          decideOn: project.canDecideIntegrity ? decision.actionsFor : undefined,
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
      decision: project.canDecideIntegrity ? decision : null,
    },
  };
}
