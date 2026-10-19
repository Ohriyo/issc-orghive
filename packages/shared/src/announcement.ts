import { z } from 'zod';
import { organizationTypeSchema, slugSchema } from './organization';

/*
 * Updates (announcements): posted by ISSC and CSC officers, readable by anyone, published at
 * once, editable and deletable by the posting council's officers (docs/DOMAIN_RULES.md).
 * The body is plain text; blank lines separate paragraphs.
 */

export const ANNOUNCEMENT_TITLE_MAX = 160;
export const ANNOUNCEMENT_BODY_MAX = 10_000;

/** Only these organization types post updates. */
export const ANNOUNCEMENT_POSTER_TYPES = ['ISSC', 'CSC'] as const;

const titleSchema = z.string().trim().min(3).max(ANNOUNCEMENT_TITLE_MAX);
const bodySchema = z.string().trim().min(1, 'Write the update').max(ANNOUNCEMENT_BODY_MAX);

export const createAnnouncementRequestSchema = z.strictObject({
  title: titleSchema,
  body: bodySchema,
});
export type CreateAnnouncementRequest = z.infer<typeof createAnnouncementRequestSchema>;

export const updateAnnouncementRequestSchema = z
  .strictObject({ title: titleSchema, body: bodySchema })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Change at least one field');
export type UpdateAnnouncementRequest = z.infer<typeof updateAnnouncementRequestSchema>;

/** GET /announcements: newest first, optionally one council's. */
export const announcementListQuerySchema = z.object({
  org: slugSchema.optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type AnnouncementListQuery = z.infer<typeof announcementListQuerySchema>;

export const announcementIdParamsSchema = z.object({ announcementId: z.uuid() });

const postingOrgSchema = z.object({
  type: organizationTypeSchema,
  slug: slugSchema,
  acronym: z.string(),
  name: z.string(),
});

export const announcementSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    body: z.string(),
    publishedAt: z.iso.datetime(),
    /** Set when the update was changed after it was published. */
    editedAt: z.iso.datetime().nullable(),
    organization: postingOrgSchema,
    /** True for the posting council's officers: they may edit or delete it. */
    canEdit: z.boolean(),
  })
  .meta({ id: 'Announcement' });
export type Announcement = z.infer<typeof announcementSchema>;

export const announcementListResponseSchema = z
  .object({
    items: z.array(announcementSchema),
    nextCursor: z.uuid().nullable(),
    /** Councils the signed-in user may post for (empty when signed out). */
    canPostFor: z.array(postingOrgSchema),
  })
  .meta({ id: 'AnnouncementListResponse' });
export type AnnouncementListResponse = z.infer<typeof announcementListResponseSchema>;

/** Paragraphs of a plain-text body: blank lines separate them; single newlines stay. */
export function paragraphsOf(body: string): string[] {
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
