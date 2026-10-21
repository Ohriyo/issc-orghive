import { z } from 'zod';
import { academicYearSchema } from './academic-term';
import { actingAsSchema } from './acting-as';
import { previewStatusSchema, scanStatusSchema } from './document';
import { handbookPageMatchSchema } from './search';
import { uploadKeySchema } from './upload';

/*
 * The Student Handbook (docs/DOMAIN_RULES.md, "Student Handbook"): the ISSC account uploads
 * one PDF edition per academic year; re-uploads are versions of that edition. Exactly one
 * edition is current (/handbook); the others are past editions. Always public and view-only;
 * only the ISSC account downloads the file. Editions are never removed.
 */

export const HANDBOOK_DOCUMENT_TYPE = { slug: 'student-handbook', name: 'Student Handbook' };

export const handbookTitle = (academicYear: string) => `Student Handbook ${academicYear}`;

/** Outline entries are kept this many levels deep, and this many in all. */
export const HANDBOOK_OUTLINE_MAX_DEPTH = 3;
export const HANDBOOK_OUTLINE_MAX_ITEMS = 400;

/** One entry of the PDF's bookmarks, resolved to the page it opens (1-based). */
export interface HandbookOutlineItem {
  title: string;
  page: number;
  items: HandbookOutlineItem[];
}

export const handbookOutlineItemSchema: z.ZodType<HandbookOutlineItem> = z.lazy(() =>
  z.object({
    title: z.string(),
    page: z.number().int().positive(),
    items: z.array(handbookOutlineItemSchema),
  }),
);

/** Route params for `/handbook/:year`. */
export const handbookYearParamsSchema = z.object({ year: academicYearSchema });

/** A past or current edition, as the editions list shows it. */
export const handbookEditionSummarySchema = z
  .object({
    academicYear: z.string(),
    isCurrent: z.boolean(),
    pageCount: z.number().int().nullable(),
    /** The watermarked page 1, signed for 15 minutes; null until it is rendered. */
    coverUrl: z.url().nullable(),
  })
  .meta({ id: 'HandbookEditionSummary' });
export type HandbookEditionSummary = z.infer<typeof handbookEditionSummarySchema>;

/**
 * One edition, ready to read: its document (for the viewer) and how to find your way in it.
 * `outline` is the PDF's bookmarks, or null when it has none; then `thumbnails` is true and
 * the contents are page thumbnails (GET /documents/:id/pages/:n?size=thumb).
 */
export const handbookEditionSchema = handbookEditionSummarySchema
  .extend({
    documentId: z.uuid(),
    versionId: z.uuid(),
    previewStatus: previewStatusSchema,
    outline: z.array(handbookOutlineItemSchema).nullable(),
    thumbnails: z.boolean(),
    /** When this version of the edition was uploaded. */
    publishedAt: z.iso.datetime(),
  })
  .meta({ id: 'HandbookEdition' });
export type HandbookEdition = z.infer<typeof handbookEditionSchema>;

/** GET /handbook (the current edition) and GET /handbook/:year. Null before any is ready. */
export const handbookResponseSchema = z
  .object({ edition: handbookEditionSchema.nullable() })
  .meta({ id: 'HandbookResponse' });
export type HandbookResponse = z.infer<typeof handbookResponseSchema>;

/** GET /handbook/editions: every edition readers can open, newest year first. */
export const handbookEditionListSchema = z
  .object({ editions: z.array(handbookEditionSummarySchema) })
  .meta({ id: 'HandbookEditionList' });
export type HandbookEditionList = z.infer<typeof handbookEditionListSchema>;

export const HANDBOOK_SEARCH_MIN = 2;
export const HANDBOOK_SEARCH_MAX = 100;
export const HANDBOOK_SEARCH_LIMIT = 30;

/** GET /handbook/:year/search?q=: words to find in that edition's text. */
export const handbookSearchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(HANDBOOK_SEARCH_MIN, `Type at least ${HANDBOOK_SEARCH_MIN} characters`)
    .max(HANDBOOK_SEARCH_MAX),
});

/** The matching pages, best first (at most HANDBOOK_SEARCH_LIMIT). */
export const handbookSearchResponseSchema = z
  .object({ query: z.string(), matches: z.array(handbookPageMatchSchema) })
  .meta({ id: 'HandbookSearchResponse' });
export type HandbookSearchResponse = z.infer<typeof handbookSearchResponseSchema>;

/**
 * POST /admin/handbook: a PDF already PUT with an upload URL (the ISSC account's own), for
 * one academic year. A year without an edition gets one; otherwise this is its next version.
 * The very first edition becomes current by itself; later ones wait for "Make current".
 */
export const uploadHandbookRequestSchema = z.strictObject({
  uploadKey: uploadKeySchema,
  actingAs: actingAsSchema,
  academicYear: academicYearSchema,
});
export type UploadHandbookRequest = z.infer<typeof uploadHandbookRequestSchema>;

/** PUT /admin/handbook/:year/current. Audited. */
export const makeHandbookCurrentRequestSchema = z.strictObject({ actingAs: actingAsSchema });

export const adminHandbookVersionSchema = z.object({
  id: z.uuid(),
  version: z.number().int(),
  uploadedAt: z.iso.datetime(),
  scanStatus: scanStatusSchema,
  previewStatus: previewStatusSchema,
  isCurrent: z.boolean(),
  actingAs: z.string().nullable(),
});
export type AdminHandbookVersion = z.infer<typeof adminHandbookVersionSchema>;

/** GET /admin/handbook: every edition with its version history (the ISSC account only). */
export const adminHandbookResponseSchema = z
  .object({
    editions: z.array(
      z.object({
        academicYear: z.string(),
        isCurrent: z.boolean(),
        documentId: z.uuid(),
        /** False until a version has passed the scan: it cannot be made current yet. */
        readable: z.boolean(),
        versions: z.array(adminHandbookVersionSchema),
      }),
    ),
  })
  .meta({ id: 'AdminHandbook' });
export type AdminHandbookResponse = z.infer<typeof adminHandbookResponseSchema>;
