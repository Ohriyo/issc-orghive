import { z } from 'zod';
import { documentStatusSchema } from './document-status';
import { documentVisibilitySchema, type DocumentVisibility } from './document';
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

/** In checklist order: pre-event, then post-event. */
export const PROJECT_TASK_TYPES = ['PROPOSAL', 'NOM', 'MOM', 'ACR', 'FINANCIAL_REPORT'] as const;
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
  ACR: 'post_event',
  FINANCIAL_REPORT: 'post_event',
};

export const PROJECT_TASK_LABELS: Record<ProjectTaskType, string> = {
  PROPOSAL: 'Project Proposal',
  NOM: 'Notice of Meeting',
  MOM: 'Minutes of Meeting',
  ACR: 'Activity Completion Report',
  FINANCIAL_REPORT: 'Financial Report',
};

/** The Paperworks document type each task's file is archived as. */
export const PROJECT_TASK_DOCUMENT_TYPES: Record<ProjectTaskType, { slug: string; name: string }> =
  {
    PROPOSAL: { slug: 'project-proposal', name: 'Project proposal' },
    NOM: { slug: 'notice-of-meeting', name: 'Notice of meeting' },
    MOM: { slug: 'minutes-of-meeting', name: 'Minutes of meeting' },
    ACR: { slug: 'activity-completion-report', name: 'Activity completion report' },
    FINANCIAL_REPORT: { slug: 'financial-report', name: 'Financial report' },
  };

/**
 * Who sees a task's file unless the officer chooses otherwise (provisional,
 * docs/DOMAIN_RULES.md): proposals and financial reports stay with the organization.
 */
export const TASK_DEFAULT_VISIBILITY: Record<ProjectTaskType, DocumentVisibility> = {
  PROPOSAL: 'members',
  NOM: 'public',
  MOM: 'public',
  ACR: 'public',
  FINANCIAL_REPORT: 'members',
};

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

/** POST /organizations/:slug/projects: all five fields are required (spec 2A). */
export const createProjectRequestSchema = z.strictObject({
  ...projectFields,
  /** Whether this project needs a Notice / Minutes of Meeting (spec 2B). */
  nomRequired: z.boolean().default(false),
  momRequired: z.boolean().default(false),
});
export type CreateProjectRequest = z.input<typeof createProjectRequestSchema>;

/** PATCH /projects/:projectId. At least one field. */
export const updateProjectRequestSchema = z
  .strictObject({ ...projectFields, nomRequired: z.boolean(), momRequired: z.boolean() })
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

/** POST /projects/:projectId/tasks/:type/documents: the uploaded file and who can see it. */
export const createTaskDocumentRequestSchema = z.strictObject({
  uploadKey: uploadKeySchema,
  visibility: documentVisibilitySchema,
});
export type CreateTaskDocumentRequest = z.infer<typeof createTaskDocumentRequestSchema>;

export const projectTaskSchema = z.object({
  type: projectTaskTypeSchema,
  status: projectTaskStatusSchema,
  /** Null for tasks without a deadline (NOM and MOM). */
  dueAt: z.iso.datetime().nullable(),
  submittedAt: z.iso.datetime().nullable(),
  /** The task's file, when the viewer may see it (the visibility rule applies). */
  document: z
    .object({
      id: z.uuid(),
      title: z.string(),
      status: documentStatusSchema,
      visibility: documentVisibilitySchema,
    })
    .nullable(),
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
  .extend({ tasks: z.array(projectTaskSchema) })
  .meta({ id: 'ProjectDetail' });
export type ProjectDetail = z.infer<typeof projectDetailSchema>;

export const projectListResponseSchema = z
  .object({ items: z.array(projectSummarySchema) })
  .meta({ id: 'ProjectListResponse' });
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;
