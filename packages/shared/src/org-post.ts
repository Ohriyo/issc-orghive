import { z } from 'zod';
import { actingAsSchema } from './acting-as';
import { organizationDetailSchema } from './public-read';
import { slugSchema } from './organization';

/*
 * Organization posts (docs/DOMAIN_RULES.md, "Organization posts"): every organization's own
 * account writes updates and highlights for its public page (/orgs/:slug). Publishing needs
 * no approval; the parent body (appeal-rules.ts decides who) may hide a post with a reason,
 * and the organization may edit and publish it again. Separate from council announcements.
 */

export const ORG_POST_TYPES = ['UPDATE', 'HIGHLIGHT'] as const;
export const orgPostTypeSchema = z.enum(ORG_POST_TYPES);
export type OrgPostType = z.infer<typeof orgPostTypeSchema>;

export const ORG_POST_STATUSES = ['DRAFT', 'SCHEDULED', 'PUBLISHED', 'HIDDEN'] as const;
export const orgPostStatusSchema = z.enum(ORG_POST_STATUSES);
export type OrgPostStatus = z.infer<typeof orgPostStatusSchema>;

export const POST_TITLE_MAX = 120;
export const POST_SUMMARY_MAX = 280;
export const POST_BODY_MAX = 10_000;
export const POST_GALLERY_MAX = 10;
export const POST_ALT_MAX = 200;
export const POST_HIDE_REASON_MAX = 500;
/** At most this many highlights are pinned to the organization page's carousel. */
export const PINNED_HIGHLIGHTS_MAX = 6;
/** The organization page shows this many recent updates; the rest are on /orgs/:slug/updates. */
export const PAGE_RECENT_UPDATES = 5;
export const POSTS_PAGE_SIZE = 10;

/** Post images: PNG, JPEG or WebP up to 5 MB, at least this wide. Stored as WebP. */
export const POST_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const POST_IMAGE_MIN_WIDTH = 640;
/** The srcset widths a post image may have (never wider than its source). */
export const POST_IMAGE_WIDTHS = [480, 960, 1440, 1920] as const;

/**
 * Where a processed post image lives: public, content-addressed and unguessable (a random
 * part plus a hash), so a draft's image is reachable only by someone given its URL.
 */
export const POST_IMAGE_KEY_PATTERN =
  /^logos\/posts\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-f0-9]{24}-[a-f0-9]{12}\.webp$/;

/** The organization slug inside a post image key, or null when the key is not one. */
export function postImageSlugOf(key: string): string | null {
  if (!POST_IMAGE_KEY_PATTERN.test(key)) return null;
  return key.split('/')[2] ?? null;
}

const altSchema = z
  .string({ error: 'Describe the image for people who cannot see it' })
  .trim()
  .min(1, 'Describe the image for people who cannot see it')
  .max(POST_ALT_MAX, `Keep the description to ${POST_ALT_MAX} characters or fewer`);

/** An uploaded image as a post refers to it. Alt text is required. */
export const postImageInputSchema = z.strictObject({
  key: z.string().regex(POST_IMAGE_KEY_PATTERN, 'Upload the image again'),
  widths: z
    .array(z.literal(POST_IMAGE_WIDTHS))
    .max(POST_IMAGE_WIDTHS.length),
  alt: altSchema,
});
export type PostImageInput = z.infer<typeof postImageInputSchema>;

/** POST /organizations/:slug/post-images answers with this (the raw image is the body). */
export const uploadedPostImageSchema = z
  .object({
    key: z.string(),
    widths: z.array(z.number().int()),
    url: z.url(),
  })
  .meta({ id: 'UploadedPostImage' });
export type UploadedPostImage = z.infer<typeof uploadedPostImageSchema>;

const titleSchema = z
  .string()
  .trim()
  .min(3, 'Give the post a title of at least 3 characters')
  .max(POST_TITLE_MAX, `Keep the title to ${POST_TITLE_MAX} characters or fewer`);
const summarySchema = z
  .string()
  .trim()
  .min(1, 'Write a short summary')
  .max(POST_SUMMARY_MAX, `Keep the summary to ${POST_SUMMARY_MAX} characters or fewer`);
const bodySchema = z
  .string()
  .trim()
  .max(POST_BODY_MAX, `Keep the text to ${POST_BODY_MAX.toLocaleString('en')} characters or fewer`);
const externalLinkSchema = z
  .url({ protocol: /^https$/, error: 'Use a full https:// link' })
  .max(2048)
  .nullable();
/** The day the event happened (Manila calendar date), when it differs from the post date. */
const eventDateSchema = z.iso.date().nullable();

/** What the editor saves; the same fields for a new post and an edit. */
const postContentSchema = z.strictObject({
  type: orgPostTypeSchema,
  title: titleSchema,
  summary: summarySchema,
  body: bodySchema.default(''),
  cover: postImageInputSchema.nullable().default(null),
  gallery: z
    .array(postImageInputSchema)
    .max(POST_GALLERY_MAX, `Add up to ${POST_GALLERY_MAX} gallery images`)
    .default([]),
  externalLink: externalLinkSchema.default(null),
  eventDate: eventDateSchema.default(null),
  actingAs: actingAsSchema,
});

/** How a save leaves the post: a draft, published now, or published at `publishAt`. */
export const POST_SAVE_ACTIONS = ['draft', 'publish', 'schedule'] as const;
export const postSaveActionSchema = z.enum(POST_SAVE_ACTIONS);
export type PostSaveAction = z.infer<typeof postSaveActionSchema>;

const scheduleRefinement = <T extends { action: PostSaveAction; publishAt?: string | null }>(
  value: T,
  ctx: z.RefinementCtx,
) => {
  if (value.action === 'schedule' && !value.publishAt) {
    ctx.addIssue({ code: 'custom', path: ['publishAt'], message: 'Choose when to publish' });
  }
};

/** POST /organizations/:slug/posts */
export const createPostRequestSchema = postContentSchema
  .extend({
    action: postSaveActionSchema,
    /** Required for `schedule`; must be in the future (checked by the service). */
    publishAt: z.iso.datetime({ offset: true }).nullable().default(null),
  })
  .superRefine(scheduleRefinement);
export type CreatePostRequest = z.input<typeof createPostRequestSchema>;
export type CreatePostInput = z.output<typeof createPostRequestSchema>;

/** PATCH /organizations/:slug/posts/:postId: the whole form again; the status is unchanged. */
export const updatePostRequestSchema = postContentSchema.omit({ type: true });
export type UpdatePostRequest = z.input<typeof updatePostRequestSchema>;
export type UpdatePostInput = z.output<typeof updatePostRequestSchema>;

/** POST …/publish: now, or at `publishAt`. Also republishes a hidden post. */
export const publishPostRequestSchema = z.strictObject({
  actingAs: actingAsSchema,
  publishAt: z.iso.datetime({ offset: true }).nullable().default(null),
});
export type PublishPostRequest = z.input<typeof publishPostRequestSchema>;

/** PUT /organizations/:slug/highlights/pinned: the pinned highlights, in carousel order. */
export const pinHighlightsRequestSchema = z.strictObject({
  actingAs: actingAsSchema,
  postIds: z
    .array(z.uuid())
    .max(PINNED_HIGHLIGHTS_MAX, `Pin up to ${PINNED_HIGHLIGHTS_MAX} highlights`)
    .refine((ids) => new Set(ids).size === ids.length, 'Each highlight once'),
});
export type PinHighlightsRequest = z.input<typeof pinHighlightsRequestSchema>;

/** POST …/hide: a governing body hides a post (moderation, not approval). */
export const hidePostRequestSchema = z.strictObject({
  actingAs: actingAsSchema,
  reason: z
    .string()
    .trim()
    .min(5, 'Tell the organization why, in a few words')
    .max(POST_HIDE_REASON_MAX, `Keep the reason to ${POST_HIDE_REASON_MAX} characters or fewer`),
});
export type HidePostRequest = z.input<typeof hidePostRequestSchema>;

export const postIdParamsSchema = z.object({ slug: slugSchema, postId: z.uuid() });

/** A post's slug: lowercase words and hyphens, unique within its organization. */
export const postSlugSchema = slugSchema.max(80);
export const postSlugParamsSchema = z.object({ slug: slugSchema, postSlug: postSlugSchema });

/** The years filter: 2000–2100, as on the updates page. */
const yearSchema = z.coerce.number().int().min(2000).max(2100);

/** GET /organizations/:slug/posts */
export const postListQuerySchema = z.object({
  type: z
    .enum(['update', 'highlight'])
    .optional()
    .transform((t) => (t ? (t.toUpperCase() as OrgPostType) : undefined)),
  year: yearSchema.optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type PostListQuery = z.output<typeof postListQuerySchema>;

/** GET /organizations/:slug/posts/manage: the own account's list, every status. */
export const managePostListQuerySchema = z.object({
  type: z
    .enum(['update', 'highlight'])
    .optional()
    .transform((t) => (t ? (t.toUpperCase() as OrgPostType) : undefined)),
  status: orgPostStatusSchema.optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type ManagePostListQuery = z.output<typeof managePostListQuerySchema>;

/** A published image: its URL, srcset and alt text. */
export const postImageSchema = z.object({
  url: z.url(),
  srcSet: z.string().nullable(),
  alt: z.string(),
});
export type PostImage = z.infer<typeof postImageSchema>;

/** What lists, the carousel and the news feed show. */
export const postCardSchema = z
  .object({
    id: z.uuid(),
    slug: z.string(),
    type: orgPostTypeSchema,
    title: z.string(),
    summary: z.string(),
    eventDate: z.iso.date().nullable(),
    publishedAt: z.iso.datetime(),
    cover: postImageSchema.nullable(),
    externalLink: z.url().nullable(),
  })
  .meta({ id: 'PostCard' });
export type PostCard = z.infer<typeof postCardSchema>;

/** Who is looking, as the page's controls need it. Never says who acted. */
export const postViewerSchema = z.object({
  /** The organization's own account: it sees hidden posts and the editor links. */
  isOwner: z.boolean(),
  /** A governing body that may hide this organization's posts (appeal-rules.ts). */
  canModerate: z.boolean(),
});
export type PostViewer = z.infer<typeof postViewerSchema>;

const postNeighbourSchema = z.object({ slug: z.string(), title: z.string() }).nullable();

/** GET /organizations/:slug/posts/:postSlug */
export const postDetailSchema = postCardSchema
  .extend({
    /** Always PUBLISHED for everyone else; the own account also sees its other posts. */
    status: orgPostStatusSchema,
    /** The Markdown body, rendered and sanitized on the server. */
    bodyHtml: z.string(),
    gallery: z.array(postImageSchema),
    editedAt: z.iso.datetime().nullable(),
    /** Older and newer published posts of the same organization. */
    previous: postNeighbourSchema,
    next: postNeighbourSchema,
    organization: z.object({
      slug: z.string(),
      acronym: z.string(),
      name: z.string(),
      logoUrl: z.url().nullable(),
    }),
    /** Only for the organization's own account, on a post it hid from everyone else. */
    moderation: z
      .object({ hiddenAt: z.iso.datetime(), reason: z.string() })
      .nullable(),
    viewer: postViewerSchema,
  })
  .meta({ id: 'PostDetail' });
export type PostDetail = z.infer<typeof postDetailSchema>;

/** GET /organizations/:slug/posts */
export const postListResponseSchema = z
  .object({
    items: z.array(postCardSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    /** Years that have posts of the requested type, newest first, for the filter. */
    years: z.array(z.number().int()),
  })
  .meta({ id: 'PostListResponse' });
export type PostListResponse = z.infer<typeof postListResponseSchema>;

/** GET /organizations/:slug/page: the header and the post sections in one response. */
export const organizationPageSchema = z
  .object({
    organization: organizationDetailSchema,
    /** Pinned highlights, in pinned order (at most PINNED_HIGHLIGHTS_MAX). */
    highlights: z.array(postCardSchema),
    /** The newest updates (at most PAGE_RECENT_UPDATES). */
    updates: z.array(postCardSchema),
    updatesTotal: z.number().int(),
    viewer: postViewerSchema,
  })
  .meta({ id: 'OrganizationPage' });
export type OrganizationPage = z.infer<typeof organizationPageSchema>;

/** The own account's view of one post: the editable source plus its state. */
export const managedPostSchema = z
  .object({
    id: z.uuid(),
    slug: z.string(),
    type: orgPostTypeSchema,
    status: orgPostStatusSchema,
    title: z.string(),
    summary: z.string(),
    body: z.string(),
    cover: postImageInputSchema.extend({ url: z.url() }).nullable(),
    gallery: z.array(postImageInputSchema.extend({ url: z.url() })),
    externalLink: z.url().nullable(),
    eventDate: z.iso.date().nullable(),
    publishAt: z.iso.datetime().nullable(),
    publishedAt: z.iso.datetime().nullable(),
    pinned: z.boolean(),
    pinOrder: z.number().int().nullable(),
    moderation: z.object({ hiddenAt: z.iso.datetime(), reason: z.string() }).nullable(),
    /** Who last acted for the account. Shown to the own account only. */
    actingAs: z.string(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'ManagedPost' });
export type ManagedPost = z.infer<typeof managedPostSchema>;

export const managedPostListResponseSchema = z
  .object({
    items: z.array(managedPostSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    pinnedCount: z.number().int(),
  })
  .meta({ id: 'ManagedPostListResponse' });
export type ManagedPostListResponse = z.infer<typeof managedPostListResponseSchema>;

/**
 * A post slug from its title: lowercase ASCII words joined by hyphens, at most 60
 * characters, cut at a word. Falls back to "post" when the title has no letters or digits.
 */
export function postSlugFromTitle(title: string): string {
  const words = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let slug = '';
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > 60) break;
    slug = next;
  }
  return slug || (words[0]?.slice(0, 60) ?? '') || 'post';
}
