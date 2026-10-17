import { z } from 'zod';
import { manilaDate } from './manila-time';
import { organizationTypeSchema, slugSchema } from './organization';
import { projectTaskTypeSchema } from './project';
import { uploadKeySchema } from './upload';

/**
 * Appeals (docs/PROJECT_WORKFLOW_SPEC.md, section 3): the only approvals in Orghive. A
 * project whose proposal deadline passed is blocked; an organization whose ACR or Financial
 * Report is overdue is frozen. Either way the organization appeals to the body above it.
 */
export const APPEAL_TYPES = ['PROJECT_BLOCK', 'ORG_FREEZE'] as const;
export const appealTypeSchema = z.enum(APPEAL_TYPES);
export type AppealType = z.infer<typeof appealTypeSchema>;

export const APPEAL_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const appealStatusSchema = z.enum(APPEAL_STATUSES);
export type AppealStatus = z.infer<typeof appealStatusSchema>;

export const APPEAL_TYPE_LABELS: Record<AppealType, string> = {
  PROJECT_BLOCK: 'Blocked project',
  ORG_FREEZE: 'Organization freeze',
};

/** The worker's verdict on an attachment. Only `clean` files can be attached or opened. */
export const ATTACHMENT_SCAN_STATUSES = ['pending', 'clean', 'infected', 'invalid'] as const;
export const attachmentScanStatusSchema = z.enum(ATTACHMENT_SCAN_STATUSES);
export type AttachmentScanStatus = z.infer<typeof attachmentScanStatusSchema>;

export const MAX_APPEAL_ATTACHMENTS = 5;
export const APPEAL_REASON_MIN = 20;
export const APPEAL_REASON_MAX = 4000;
/** Rejections must say why (provisional, docs/DOMAIN_RULES.md, 2026-10-17). */
export const REJECT_REMARKS_MIN = 10;
export const REMARKS_MAX = 2000;

/** The written reason of an appeal (the web form validates with this too). */
export const appealReasonSchema = z
  .string()
  .trim()
  .min(APPEAL_REASON_MIN, `Explain the appeal in at least ${APPEAL_REASON_MIN} characters`)
  .max(APPEAL_REASON_MAX, `Keep the reason under ${APPEAL_REASON_MAX} characters`);

const attachmentIdsSchema = z
  .array(z.uuid())
  .max(MAX_APPEAL_ATTACHMENTS, `Attach at most ${MAX_APPEAL_ATTACHMENTS} files`)
  .default([])
  .transform((ids) => [...new Set(ids)]);

/** POST /organizations/:slug/appeals. Attachments must have passed the virus scan. */
export const submitAppealRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('PROJECT_BLOCK'),
    projectId: z.uuid(),
    reason: appealReasonSchema,
    attachmentIds: attachmentIdsSchema,
  }),
  z.strictObject({
    type: z.literal('ORG_FREEZE'),
    freezeId: z.uuid(),
    reason: appealReasonSchema,
    attachmentIds: attachmentIdsSchema,
  }),
]);
export type SubmitAppealRequest = z.input<typeof submitAppealRequestSchema>;
export type SubmitAppeal = z.output<typeof submitAppealRequestSchema>;

/** The new deadline an approval sets: a Manila date after today; due 23:59:59 that day. */
export const newDueDateSchema = z.iso
  .date('Choose the new due date')
  .refine((date) => date > manilaDate(new Date()), 'The new due date must be after today');

const optionalRemarksSchema = z
  .string()
  .trim()
  .max(REMARKS_MAX, `Keep the remarks under ${REMARKS_MAX} characters`)
  .optional()
  .transform((remarks) => remarks || undefined);

/** POST /appeals/:appealId/decision. Approve sets a new due date; reject must explain. */
export const decideAppealRequestSchema = z.discriminatedUnion('decision', [
  z.strictObject({
    decision: z.literal('approve'),
    newDueDate: newDueDateSchema,
    remarks: optionalRemarksSchema,
  }),
  z.strictObject({
    decision: z.literal('reject'),
    remarks: z
      .string()
      .trim()
      .min(REJECT_REMARKS_MIN, `Explain the rejection in at least ${REJECT_REMARKS_MIN} characters`)
      .max(REMARKS_MAX, `Keep the remarks under ${REMARKS_MAX} characters`),
  }),
]);
export type DecideAppealRequest = z.input<typeof decideAppealRequestSchema>;
export type DecideAppeal = z.output<typeof decideAppealRequestSchema>;

export const appealIdParamsSchema = z.object({ appealId: z.uuid() });
export const appealAttachmentParamsSchema = z.object({
  appealId: z.uuid(),
  attachmentId: z.uuid(),
});
export const orgAttachmentParamsSchema = z.object({ slug: slugSchema, attachmentId: z.uuid() });

/** GET /appeals/queue: what waits for the user's decision, or what they decided. */
export const appealQueueQuerySchema = z.object({
  status: z.enum(['pending', 'decided']).default('pending'),
});
export type AppealQueueQuery = z.infer<typeof appealQueueQuerySchema>;

/** POST /organizations/:slug/appeal-attachments: claims an uploaded file for an appeal. */
export const createAppealAttachmentRequestSchema = z.strictObject({ uploadKey: uploadKeySchema });

export const appealAttachmentSchema = z
  .object({
    id: z.uuid(),
    filename: z.string(),
    contentType: z.string(),
    sizeBytes: z.number().int(),
    scanStatus: attachmentScanStatusSchema,
  })
  .meta({ id: 'AppealAttachment' });
export type AppealAttachment = z.infer<typeof appealAttachmentSchema>;

export const attachmentDownloadResponseSchema = z.object({
  /** Pre-signed GET, valid for 5 minutes. */
  url: z.url(),
  expiresAt: z.iso.datetime(),
});
export type AttachmentDownloadResponse = z.infer<typeof attachmentDownloadResponseSchema>;

const orgBriefSchema = z.object({
  type: organizationTypeSchema,
  slug: slugSchema,
  acronym: z.string(),
  name: z.string(),
});

export const appealSchema = z
  .object({
    id: z.uuid(),
    type: appealTypeSchema,
    status: appealStatusSchema,
    reason: z.string(),
    /** The decider's remarks; always present on a rejection. */
    remarks: z.string().nullable(),
    /** The deadline an approval set. */
    newDueAt: z.iso.datetime().nullable(),
    submittedAt: z.iso.datetime(),
    decidedAt: z.iso.datetime().nullable(),
    submittedBy: z.object({ name: z.string() }),
    decidedBy: z.object({ name: z.string() }).nullable(),
    organization: orgBriefSchema,
    /** The organization that decides it: the college's CSC for an SBO, the ISSC otherwise. */
    decider: orgBriefSchema,
    project: z.object({ id: z.uuid(), name: z.string(), targetDate: z.iso.date() }),
    /** ORG_FREEZE only: the reports that were overdue. */
    freeze: z.object({ id: z.uuid(), reports: z.array(projectTaskTypeSchema) }).nullable(),
    attachments: z.array(appealAttachmentSchema),
    /** Whether the viewer may decide it now. */
    canDecide: z.boolean(),
  })
  .meta({ id: 'Appeal' });
export type Appeal = z.infer<typeof appealSchema>;

export const appealListResponseSchema = z
  .object({ items: z.array(appealSchema) })
  .meta({ id: 'AppealListResponse' });
export type AppealListResponse = z.infer<typeof appealListResponseSchema>;

const appealBriefSchema = z.object({ id: z.uuid(), submittedAt: z.iso.datetime() });
const rejectionSchema = z.object({ remarks: z.string(), decidedAt: z.iso.datetime() });

/** GET /organizations/:slug/compliance: what the dashboard banner shows. */
export const organizationComplianceSchema = z
  .object({
    /** True while any freeze is open: the organization cannot create projects. */
    frozen: z.boolean(),
    freezes: z.array(
      z.object({
        id: z.uuid(),
        project: z.object({ id: z.uuid(), name: z.string() }),
        reports: z.array(projectTaskTypeSchema),
        frozenAt: z.iso.datetime(),
        pendingAppeal: appealBriefSchema.nullable(),
        lastRejection: rejectionSchema.nullable(),
      }),
    ),
    blockedProjects: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        proposalDueAt: z.iso.datetime(),
        pendingAppeal: appealBriefSchema.nullable(),
        lastRejection: rejectionSchema.nullable(),
      }),
    ),
    /** Who decides this organization's appeals. */
    decider: orgBriefSchema,
  })
  .meta({ id: 'OrganizationCompliance' });
export type OrganizationCompliance = z.infer<typeof organizationComplianceSchema>;
