import { z } from 'zod';
import { actingAsSchema } from './acting-as';
import { academicYearSchema, semesterSchema } from './academic-term';
import { documentStatusSchema } from './document-status';
import { organizationTypeSchema, slugSchema } from './organization';
import { documentTagsSchema, uploadKeySchema } from './upload';

/**
 * Who may see an available document. The owning organization's account chooses it on upload
 * and may change it at any time; nobody else can (docs/DOMAIN_RULES.md, "Visibility"):
 * - public: anyone, including signed-out visitors.
 * - governing: the organization, its college's CSC and the ISSC (the governing bodies).
 * - private: the organization's account only. No exceptions: not its CSC, not the ISSC,
 *   not the super admin.
 * Before a document is available, and once archived, only the organization sees it.
 */
export const DOCUMENT_VISIBILITIES = ['public', 'governing', 'private'] as const;
export const documentVisibilitySchema = z.enum(DOCUMENT_VISIBILITIES);
export type DocumentVisibility = z.infer<typeof documentVisibilitySchema>;
export const DEFAULT_DOCUMENT_VISIBILITY: DocumentVisibility = 'public';

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
 * storage with an upload URL, and who is acting for the account. Creates the document with
 * that file as version 1, `scanning`, and queues its virus scan and processing; it becomes
 * `available` once the file is clean.
 */
export const createDocumentRequestSchema = documentMetadataSchema.extend({
  uploadKey: uploadKeySchema,
  actingAs: actingAsSchema,
});
export type CreateDocumentRequest = z.infer<typeof createDocumentRequestSchema>;

/** POST /documents/:documentId/versions: a re-upload, from a new upload URL. */
export const addVersionRequestSchema = z.strictObject({
  uploadKey: uploadKeySchema,
  actingAs: actingAsSchema,
});
export type AddVersionRequest = z.infer<typeof addVersionRequestSchema>;

/** Route params for `/documents/:documentId/versions/:versionId`. */
export const versionParamsSchema = z.object({ documentId: z.uuid(), versionId: z.uuid() });

/**
 * Where a file is in processing: `pending` until the worker has checked it, `clean` once
 * it passed, `infected` if ClamAV flagged it, `invalid` if its bytes are not the type it
 * claimed. Only clean files can be downloaded.
 */
export const SCAN_STATUSES = ['pending', 'clean', 'infected', 'invalid'] as const;
export const scanStatusSchema = z.enum(SCAN_STATUSES);
export type ScanStatus = z.infer<typeof scanStatusSchema>;

/**
 * PATCH /documents/:documentId: details only, at any time before archiving. At least one
 * field; `null` clears an optional one. Visibility has its own endpoint (below).
 */
export const updateDocumentRequestSchema = z
  .strictObject({
    typeId: z.uuid(),
    title: titleSchema,
    description: descriptionSchema.nullable(),
    academicYear: academicYearSchema,
    semester: semesterSchema.nullable(),
    tags: documentTagsSchema,
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Change at least one field');
export type UpdateDocumentRequest = z.infer<typeof updateDocumentRequestSchema>;

/**
 * PATCH /documents/:documentId/visibility: the owning organization's account only, at any
 * time. Audited.
 */
export const updateVisibilityRequestSchema = z.strictObject({
  visibility: documentVisibilitySchema,
});
export type UpdateVisibilityRequest = z.infer<typeof updateVisibilityRequestSchema>;

/** GET /organizations/:slug/documents query string. Unknown keys are dropped. */
export const documentListQuerySchema = z.object({
  typeId: z.uuid().optional(),
  academicYear: academicYearSchema.optional(),
  semester: semesterSchema.optional(),
  status: documentStatusSchema.optional(),
  visibility: documentVisibilitySchema.optional(),
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
    /**
     * The officer who uploaded it for the account. Only the owning organization's account
     * gets it; null for everyone else and for files Orghive made (the Semestral End Report).
     */
    actingAs: z.string().nullable(),
  })
  .meta({ id: 'DocumentVersion' });
export type DocumentVersion = z.infer<typeof documentVersionSchema>;

export const documentVersionListResponseSchema = z
  .object({ versions: z.array(documentVersionSchema) })
  .meta({ id: 'DocumentVersionList' });
export type DocumentVersionListResponse = z.infer<typeof documentVersionListResponseSchema>;

/**
 * GET /documents/:documentId/versions/:versionId/download-url: a 5-minute signed link to the
 * original file, for the owning organization's account only (everyone else views pages).
 */
export const downloadUrlResponseSchema = z
  .object({ url: z.url(), expiresAt: z.iso.datetime() })
  .meta({ id: 'DownloadUrlResponse' });
export type DownloadUrlResponse = z.infer<typeof downloadUrlResponseSchema>;

/**
 * The view-only preview of a version: page images the worker renders and watermarks
 * ("NwSSU Orghive · View only"). Non-owners view documents only through these; the original
 * file is served to the owning organization alone (CLAUDE.md, "Security rules").
 * - pending: not rendered yet (new uploads, and files from before previews existed).
 * - ready: every page (up to MAX_PREVIEW_PAGES) is rendered.
 * - failed: the file could not be rendered (damaged or encrypted).
 */
export const PREVIEW_STATUSES = ['pending', 'ready', 'failed'] as const;
export const previewStatusSchema = z.enum(PREVIEW_STATUSES);
export type PreviewStatus = z.infer<typeof previewStatusSchema>;

/** Longer files are previewed up to this page; the owner can still download the whole file. */
export const MAX_PREVIEW_PAGES = 500;

/** One rendered page's size in px, so the viewer can reserve its space before it loads. */
export const previewPageSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type PreviewPage = z.infer<typeof previewPageSchema>;

/**
 * GET /documents/:documentId/viewer: the current version's preview. `token` signs every page
 * request for 5 minutes (`expiresAt`); the client asks again for a fresh one before then.
 * Pages are fetched from GET /documents/:documentId/pages/:page?token=…
 */
export const documentViewerResponseSchema = z
  .object({
    versionId: z.uuid(),
    status: previewStatusSchema,
    pages: z.array(previewPageSchema),
    /** How many pages the file has; more than `pages.length` when it was capped. */
    totalPages: z.number().int().nonnegative(),
    token: z.string().nullable(),
    expiresAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'DocumentViewer' });
export type DocumentViewerResponse = z.infer<typeof documentViewerResponseSchema>;

/** Route params and query for GET /documents/:documentId/pages/:page. */
export const documentPageParamsSchema = z.object({
  documentId: z.uuid(),
  page: z.coerce.number().int().min(1).max(MAX_PREVIEW_PAGES),
});
export const documentPageQuerySchema = z.object({
  token: z.string().min(1).max(2048),
  /** `thumb`: the small copy the handbook's contents show when the PDF has no bookmarks. */
  size: z.enum(['full', 'thumb']).default('full'),
});

/**
 * GET /documents/:documentId/viewer?versionId=: an older version. Any version of a
 * Constitution & By-laws; for other documents, the owning account's own only.
 */
export const documentViewerQuerySchema = z.object({ versionId: z.uuid().optional() });
