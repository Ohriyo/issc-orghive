import { z } from 'zod';
import { actingAsSchema } from './acting-as';
import { documentStatusSchema } from './document-status';
import { documentVisibilitySchema, type DocumentVisibility } from './document';
import { financialFiguresSchema, projectFinancialFiguresSchema } from './leaderboard';
import { manilaDate } from './manila-time';
import { organizationTypeSchema, slugSchema } from './organization';
import { uploadKeySchema, uploadUrlRequestSchema, type UploadContentType } from './upload';

/**
 * Projects and their milestone checklist (docs/PROJECT_WORKFLOW_SPEC.md, sections 2A and
 * 2B). `blocked` is set by the compliance rules (section 3, F11); `completed` once every
 * task the project needs is submitted.
 */
export const PROJECT_STATUSES = ['active', 'blocked', 'completed'] as const;
export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

/**
 * In checklist order: pre-event, then post-event. The Attendance Sheet is listed with the
 * pre-event files but is due with the ACR, since it is signed during the event.
 */
export const PROJECT_TASK_TYPES = [
  'PROPOSAL',
  'NOM',
  'MOM',
  'COMMUNICATION_LETTER',
  'ATTENDANCE_SHEET',
  'OTHER_PRE_EVENT',
  'ACR',
  'FINANCIAL_REPORT',
] as const;
export const projectTaskTypeSchema = z.enum(PROJECT_TASK_TYPES);
export type ProjectTaskType = z.infer<typeof projectTaskTypeSchema>;

/** `submitted`: its file is uploaded and passed the virus scan. Nothing is reviewed. */
export const PROJECT_TASK_STATUSES = ['locked', 'open', 'submitted'] as const;
export const projectTaskStatusSchema = z.enum(PROJECT_TASK_STATUSES);
export type ProjectTaskStatus = z.infer<typeof projectTaskStatusSchema>;

export const PROJECT_TASK_PHASE: Record<ProjectTaskType, 'pre_event' | 'post_event'> = {
  PROPOSAL: 'pre_event',
  NOM: 'pre_event',
  MOM: 'pre_event',
  COMMUNICATION_LETTER: 'pre_event',
  ATTENDANCE_SHEET: 'pre_event',
  OTHER_PRE_EVENT: 'pre_event',
  ACR: 'post_event',
  FINANCIAL_REPORT: 'post_event',
};

export const PROJECT_TASK_LABELS: Record<ProjectTaskType, string> = {
  PROPOSAL: 'Project Proposal',
  NOM: 'Notice of Meeting',
  MOM: 'Minutes of Meeting',
  COMMUNICATION_LETTER: 'Communication Letter',
  ATTENDANCE_SHEET: 'Attendance Sheet',
  OTHER_PRE_EVENT: 'Other pre-event document',
  ACR: 'Activity Completion Report',
  FINANCIAL_REPORT: 'Financial Report',
};

/** The Paperworks document type each task's file is archived as. */
export const PROJECT_TASK_DOCUMENT_TYPES: Record<ProjectTaskType, { slug: string; name: string }> =
  {
    PROPOSAL: { slug: 'project-proposal', name: 'Project proposal' },
    NOM: { slug: 'notice-of-meeting', name: 'Notice of meeting' },
    MOM: { slug: 'minutes-of-meeting', name: 'Minutes of meeting' },
    COMMUNICATION_LETTER: { slug: 'communication-letter', name: 'Communication letter' },
    ATTENDANCE_SHEET: { slug: 'attendance-sheet', name: 'Attendance sheet' },
    OTHER_PRE_EVENT: { slug: 'other-pre-event-document', name: 'Other pre-event document' },
    ACR: { slug: 'activity-completion-report', name: 'Activity completion report' },
    FINANCIAL_REPORT: { slug: 'financial-report', name: 'Financial report' },
  };

/**
 * Who sees a task's file unless the officer chooses otherwise (provisional,
 * docs/DOMAIN_RULES.md): proposals and financial reports stay with the organization, and so
 * do letters, attendance sheets (students' names and signatures) and other files (decided
 * 2026-10-21).
 */
export const TASK_DEFAULT_VISIBILITY: Record<ProjectTaskType, DocumentVisibility> = {
  PROPOSAL: 'private',
  NOM: 'public',
  MOM: 'public',
  COMMUNICATION_LETTER: 'private',
  ATTENDANCE_SHEET: 'private',
  OTHER_PRE_EVENT: 'private',
  ACR: 'public',
  FINANCIAL_REPORT: 'private',
};

/**
 * Tasks that hold several files, each with its own label: Communication Letters (one per
 * office, e.g. "Letter to the Dean") and other pre-event documents. Every other task holds
 * one file, whose re-uploads are its versions.
 */
export const MULTI_FILE_TASK_TYPES = ['COMMUNICATION_LETTER', 'OTHER_PRE_EVENT'] as const;
export function isMultiFileTask(type: ProjectTaskType): boolean {
  return (MULTI_FILE_TASK_TYPES as readonly string[]).includes(type);
}

/**
 * Tasks the organization ticks on creation when the project needs them (spec 2B), and the
 * project field that records each tick. They can change until that task is submitted.
 */
export const PRE_EVENT_CHOICES = {
  NOM: 'nomRequired',
  MOM: 'momRequired',
  COMMUNICATION_LETTER: 'communicationLetterRequired',
  ATTENDANCE_SHEET: 'attendanceSheetRequired',
} as const satisfies Partial<Record<ProjectTaskType, string>>;
export type PreEventChoiceField = (typeof PRE_EVENT_CHOICES)[keyof typeof PRE_EVENT_CHOICES];

/** A file's label in a multi-file task, e.g. "Letter to the Dean". */
export const taskFileLabelSchema = z
  .string()
  .trim()
  .min(2, 'Name this file, e.g. "Letter to the Dean"')
  .max(80, 'Keep the name under 80 characters');

/** Task files are merged into the Semestral End Report, so only PDF and images. */
export const TASK_UPLOAD_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const satisfies UploadContentType[];
export const TASK_UPLOAD_ACCEPT = '.pdf,.jpg,.jpeg,.png';

const nameSchema = z.string().trim().min(3, 'Use at least 3 characters').max(200);
const shortTextSchema = (what: string) =>
  z.string().trim().min(2, `Enter the ${what}`).max(300, `Keep the ${what} under 300 characters`);

/** `YYYY-MM-DD`, today or later in Manila. */
export const targetDateSchema = z.iso
  .date('Choose the event date')
  .refine((date) => date >= manilaDate(new Date()), 'The target date cannot be in the past');

const projectFields = {
  name: nameSchema,
  targetDate: targetDateSchema,
  location: shortTextSchema('location'),
  beneficiaries: shortTextSchema('target beneficiaries'),
  description: z.string().trim().min(1, 'Describe the project briefly').max(2000),
};

/** Which optional pre-event documents the project needs (spec 2B); none by default. */
const preEventChoices = {
  nomRequired: z.boolean(),
  momRequired: z.boolean(),
  communicationLetterRequired: z.boolean(),
  attendanceSheetRequired: z.boolean(),
};

/** POST /organizations/:slug/projects: all five fields are required (spec 2A). */
export const createProjectRequestSchema = z.strictObject({
  ...projectFields,
  nomRequired: preEventChoices.nomRequired.default(false),
  momRequired: preEventChoices.momRequired.default(false),
  communicationLetterRequired: preEventChoices.communicationLetterRequired.default(false),
  attendanceSheetRequired: preEventChoices.attendanceSheetRequired.default(false),
});
export type CreateProjectRequest = z.input<typeof createProjectRequestSchema>;

/** PATCH /projects/:projectId. At least one field. */
export const updateProjectRequestSchema = z
  .strictObject({ ...projectFields, ...preEventChoices })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Change at least one field');
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export const projectIdParamsSchema = z.object({ projectId: z.uuid() });
export const projectTaskParamsSchema = z.object({
  projectId: z.uuid(),
  type: projectTaskTypeSchema,
});

/** POST /projects/:projectId/tasks/:type/upload-url: the usual upload checks, PDF or image. */
export const taskUploadUrlRequestSchema = uploadUrlRequestSchema.refine(
  (body) => (TASK_UPLOAD_CONTENT_TYPES as readonly string[]).includes(body.contentType),
  { path: ['contentType'], message: 'Task files must be PDF, JPG or PNG' },
);

/**
 * POST /projects/:projectId/tasks/:type/documents: the uploaded file and who can see it. In
 * a multi-file task (MULTI_FILE_TASK_TYPES) a new file needs its `label`; `documentId`
 * instead uploads a new version of one of the task's files.
 */
export const createTaskDocumentRequestSchema = z.strictObject({
  uploadKey: uploadKeySchema,
  visibility: documentVisibilitySchema,
  actingAs: actingAsSchema,
  label: taskFileLabelSchema.optional(),
  documentId: z.uuid().optional(),
});
export type CreateTaskDocumentRequest = z.infer<typeof createTaskDocumentRequestSchema>;

/**
 * POST /projects/:projectId/tasks/FINANCIAL_REPORT/documents: every Financial Report file
 * comes with its totals (spec 5D), the first upload and every new version alike.
 */
export const createFinancialReportDocumentRequestSchema = createTaskDocumentRequestSchema.extend({
  figures: financialFiguresSchema,
});
export type CreateFinancialReportDocumentRequest = z.infer<
  typeof createFinancialReportDocumentRequestSchema
>;

/**
 * The body schema for a task's file: the Financial Report also carries its figures; a
 * multi-file task's new file needs a label; a one-file task takes neither a label nor a
 * `documentId` (its re-uploads are versions of its one file).
 */
export function taskDocumentRequestSchemaFor(type: ProjectTaskType) {
  if (type === 'FINANCIAL_REPORT') {
    return createFinancialReportDocumentRequestSchema.refine(
      (body) => body.label === undefined && body.documentId === undefined,
      'This task holds one file; upload it again to replace it',
    );
  }
  const multi = isMultiFileTask(type);
  return createTaskDocumentRequestSchema.superRefine((body, ctx) => {
    if (multi && body.documentId === undefined && body.label === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['label'],
        message: 'Name this file, e.g. "Letter to the Dean"',
      });
    }
    if (!multi && (body.label !== undefined || body.documentId !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['label'],
        message: 'This task holds one file; upload it again to replace it',
      });
    }
  });
}

/** A file of a task, as the checklist shows it (the visibility rule applies). */
const taskDocumentBriefSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  status: documentStatusSchema,
  visibility: documentVisibilitySchema,
});

export const projectTaskSchema = z.object({
  type: projectTaskTypeSchema,
  status: projectTaskStatusSchema,
  /**
   * False only for the optional "Other pre-event document": never due, and the project
   * completes without it.
   */
  required: z.boolean(),
  /** Null for tasks without a deadline (NOM, MOM and other pre-event documents). */
  dueAt: z.iso.datetime().nullable(),
  submittedAt: z.iso.datetime().nullable(),
  /** A one-file task's file, when the viewer may see it (the visibility rule applies). */
  document: taskDocumentBriefSchema.nullable(),
  /** A multi-file task's files the viewer may see, oldest first, each with its label. */
  files: z.array(z.object({ label: z.string(), document: taskDocumentBriefSchema })),
});
export type ProjectTask = z.infer<typeof projectTaskSchema>;

export const projectSummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    targetDate: z.iso.date(),
    location: z.string(),
    beneficiaries: z.string(),
    description: z.string(),
    status: projectStatusSchema,
    proposalDueAt: z.iso.datetime(),
    postEventDueAt: z.iso.datetime(),
    nomRequired: z.boolean(),
    momRequired: z.boolean(),
    communicationLetterRequired: z.boolean(),
    attendanceSheetRequired: z.boolean(),
    /** The earliest deadline among open tasks; null when nothing is due. */
    nextDeadline: z.object({ type: projectTaskTypeSchema, dueAt: z.iso.datetime() }).nullable(),
    organization: z.object({
      type: organizationTypeSchema,
      slug: slugSchema,
      acronym: z.string(),
      name: z.string(),
    }),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'ProjectSummary' });
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const projectDetailSchema = projectSummarySchema
  .extend({
    tasks: z.array(projectTaskSchema),
    /** The Financial Report's totals, once entered (spec 5D); public on the leaderboard. */
    financialFigures: projectFinancialFiguresSchema.nullable(),
  })
  .meta({ id: 'ProjectDetail' });
export type ProjectDetail = z.infer<typeof projectDetailSchema>;

export const projectListResponseSchema = z
  .object({ items: z.array(projectSummarySchema) })
  .meta({ id: 'ProjectListResponse' });
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;
