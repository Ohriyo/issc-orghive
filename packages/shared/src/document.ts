import { z } from 'zod';
import { academicYearSchema, semesterSchema } from './academic-term';
import { documentStatusSchema } from './document-status';
import { organizationTypeSchema, slugSchema } from './organization';

/**
 * Who may see an approved document (docs/DOMAIN_RULES.md, provisional):
 * - public: anyone, including signed-out visitors.
 * - members: any signed-in NwSSU account.
 * - private: active members of the owning organization, its approvers and admins.
 * Unapproved documents follow the status rule whatever their visibility.
 */
export const DOCUMENT_VISIBILITIES = ['public', 'members', 'private'] as const;
export const documentVisibilitySchema = z.enum(DOCUMENT_VISIBILITIES);
export type DocumentVisibility = z.infer<typeof documentVisibilitySchema>;
export const DEFAULT_DOCUMENT_VISIBILITY: DocumentVisibility = 'members';

/** Route params for `/documents/:documentId`. */
export const documentIdParamsSchema = z.object({ documentId: z.uuid() });
export type DocumentIdParams = z.infer<typeof documentIdParamsSchema>;

const titleSchema = z.string().trim().min(3).max(200);
const descriptionSchema = z.string().trim().max(2000);

/**
 * POST /organizations/:slug/documents. Creates a draft; the file is uploaded separately.
 * Strict, so a client cannot set `status`, `organizationId` or other server-owned fields.
 */
export const createDocumentRequestSchema = z.strictObject({
  typeId: z.uuid(),
  title: titleSchema,
  description: descriptionSchema.optional(),
  academicYear: academicYearSchema,
  semester: semesterSchema.optional(),
  visibility: documentVisibilitySchema.default(DEFAULT_DOCUMENT_VISIBILITY),
});
export type CreateDocumentRequest = z.infer<typeof createDocumentRequestSchema>;

/** PATCH /documents/:documentId. At least one field; `null` clears an optional one. */
export const updateDocumentRequestSchema = z
  .strictObject({
    typeId: z.uuid(),
    title: titleSchema,
    description: descriptionSchema.nullable(),
    academicYear: academicYearSchema,
    semester: semesterSchema.nullable(),
    visibility: documentVisibilitySchema,
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Change at least one field');
export type UpdateDocumentRequest = z.infer<typeof updateDocumentRequestSchema>;

/**
 * POST /documents/:documentId/approve and /reject. Whether a reason is required on
 * rejection is an open question in docs/DOMAIN_RULES.md, so it is optional for now.
 */
export const documentDecisionRequestSchema = z.strictObject({
  comment: z.string().trim().min(1).max(2000).optional(),
});
export type DocumentDecisionRequest = z.infer<typeof documentDecisionRequestSchema>;

/** GET /organizations/:slug/documents query string. Unknown keys are dropped. */
export const documentListQuerySchema = z.object({
  typeId: z.uuid().optional(),
  academicYear: academicYearSchema.optional(),
  semester: semesterSchema.optional(),
  status: documentStatusSchema.optional(),
  q: z.string().trim().min(1).max(200).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;

export const documentSummarySchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    description: z.string().nullable(),
    academicYear: z.string(),
    semester: semesterSchema.nullable(),
    status: documentStatusSchema,
    visibility: documentVisibilitySchema,
    submittedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    organization: z.object({
      type: organizationTypeSchema,
      slug: slugSchema,
      acronym: z.string(),
      name: z.string(),
    }),
    type: z.object({ id: z.uuid(), slug: z.string(), name: z.string() }),
    currentVersion: z
      .object({
        version: z.number().int(),
        originalFilename: z.string(),
        mimeType: z.string(),
        sizeBytes: z.number().int(),
        scanStatus: z.enum(['pending', 'clean', 'infected']),
        createdAt: z.iso.datetime(),
      })
      .nullable(),
  })
  .meta({ id: 'DocumentSummary' });
export type DocumentSummary = z.infer<typeof documentSummarySchema>;

export const documentListResponseSchema = z
  .object({ items: z.array(documentSummarySchema), nextCursor: z.uuid().nullable() })
  .meta({ id: 'DocumentListResponse' });
export type DocumentListResponse = z.infer<typeof documentListResponseSchema>;
