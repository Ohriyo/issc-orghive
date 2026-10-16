import { z } from 'zod';
import { academicYearSchema, semesterSchema } from './academic-term';
import { documentStatusSchema } from './document-status';
import { organizationTypeSchema, slugSchema } from './organization';
import { documentTagsSchema, uploadKeySchema } from './upload';

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
 * A document's details as the upload form collects them. Strict, so a client cannot set
 * `status`, `organizationId` or other server-owned fields.
 */
export const documentMetadataSchema = z.strictObject({
  typeId: z.uuid('Choose a document type'),
  title: titleSchema,
  description: descriptionSchema.optional(),
  academicYear: academicYearSchema,
  semester: semesterSchema.optional(),
  visibility: documentVisibilitySchema.default(DEFAULT_DOCUMENT_VISIBILITY),
  tags: documentTagsSchema.default([]),
});
export type DocumentMetadata = z.input<typeof documentMetadataSchema>;

/**
 * POST /organizations/:slug/documents: the metadata plus the key of a file already PUT to
 * storage with an upload URL. Creates the document with that file as version 1, pending
 * review, and queues its virus scan and processing.
 */
export const createDocumentRequestSchema = documentMetadataSchema.extend({
  uploadKey: uploadKeySchema,
});
export type CreateDocumentRequest = z.infer<typeof createDocumentRequestSchema>;

/** POST /documents/:documentId/versions: a re-upload, from a new upload URL. */
export const addVersionRequestSchema = z.strictObject({ uploadKey: uploadKeySchema });
export type AddVersionRequest = z.infer<typeof addVersionRequestSchema>;

/** Route params for `/documents/:documentId/versions/:versionId`. */
export const versionParamsSchema = z.object({ documentId: z.uuid(), versionId: z.uuid() });

/**
 * Where a file is in processing: `pending` until the worker has checked it, `clean` once
 * it passed, `infected` if ClamAV flagged it, `invalid` if its bytes are not the type it
 * claimed. Only clean files can be downloaded or approved.
 */
export const SCAN_STATUSES = ['pending', 'clean', 'infected', 'invalid'] as const;
export const scanStatusSchema = z.enum(SCAN_STATUSES);
export type ScanStatus = z.infer<typeof scanStatusSchema>;

/** PATCH /documents/:documentId. At least one field; `null` clears an optional one. */
export const updateDocumentRequestSchema = z
  .strictObject({
    typeId: z.uuid(),
    title: titleSchema,
    description: descriptionSchema.nullable(),
    academicYear: academicYearSchema,
    semester: semesterSchema.nullable(),
    visibility: documentVisibilitySchema,
    tags: documentTagsSchema,
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

/** A kind of Paperworks document, e.g. "Activity proposal". Types are data, not an enum. */
export const documentTypeSchema = z
  .object({ id: z.uuid(), slug: z.string(), name: z.string() })
  .meta({ id: 'DocumentType' });
export type DocumentType = z.infer<typeof documentTypeSchema>;

/** GET /document-types, in name order. */
export const documentTypeListResponseSchema = z
  .object({ types: z.array(documentTypeSchema) })
  .meta({ id: 'DocumentTypeListResponse' });
export type DocumentTypeListResponse = z.infer<typeof documentTypeListResponseSchema>;

/** GET /documents?q=: search every organization's Paperworks the viewer may see. */
export const documentSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});
export type DocumentSearchQuery = z.infer<typeof documentSearchQuerySchema>;

export const documentSummarySchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    description: z.string().nullable(),
    academicYear: z.string(),
    semester: semesterSchema.nullable(),
    status: documentStatusSchema,
    visibility: documentVisibilitySchema,
    tags: z.array(z.string()),
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
        scanStatus: scanStatusSchema,
        createdAt: z.iso.datetime(),
        /** Signed preview of page 1 (PDFs), valid for 15 minutes; null until processed. */
        thumbnailUrl: z.url().nullable(),
      })
      .nullable(),
  })
  .meta({ id: 'DocumentSummary' });
export type DocumentSummary = z.infer<typeof documentSummarySchema>;

export const documentListResponseSchema = z
  .object({ items: z.array(documentSummarySchema), nextCursor: z.uuid().nullable() })
  .meta({ id: 'DocumentListResponse' });
export type DocumentListResponse = z.infer<typeof documentListResponseSchema>;

/** One file of a document. Every upload is a new version; none is ever overwritten. */
export const documentVersionSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int(),
    originalFilename: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int(),
    scanStatus: scanStatusSchema,
    createdAt: z.iso.datetime(),
    /** The version the document shows now. A re-upload becomes current once it is clean. */
    isCurrent: z.boolean(),
  })
  .meta({ id: 'DocumentVersion' });
export type DocumentVersion = z.infer<typeof documentVersionSchema>;

export const documentVersionListResponseSchema = z
  .object({ versions: z.array(documentVersionSchema) })
  .meta({ id: 'DocumentVersionList' });
export type DocumentVersionListResponse = z.infer<typeof documentVersionListResponseSchema>;

/** GET /documents/:documentId/versions/:versionId/download-url: a 5-minute signed link. */
export const downloadUrlResponseSchema = z
  .object({ url: z.url(), expiresAt: z.iso.datetime() })
  .meta({ id: 'DownloadUrlResponse' });
export type DownloadUrlResponse = z.infer<typeof downloadUrlResponseSchema>;
