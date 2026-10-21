import { z } from 'zod';
import { organizationTypeSchema, slugSchema } from './organization';

/** Route params for every `/:slug` public read. */
export const slugParamsSchema = z.object({ slug: slugSchema });
export type SlugParams = z.infer<typeof slugParamsSchema>;

/** Public, CDN-cacheable logo URL, or null when the organization has no logo. */
const logoUrlSchema = z.url().nullable().meta({ description: 'Public logo URL (CDN-cacheable)' });
/** For <img srcset>: the same logo resized, e.g. "https://…/jpice-ab12-128.webp 128w, …". */
const logoSrcSetSchema = z
  .string()
  .nullable()
  .meta({ description: 'srcset of resized logo variants (128w, 256w, …), or null' });

export const organizationSummarySchema = z
  .object({
    type: organizationTypeSchema,
    slug: slugSchema,
    acronym: z.string(),
    name: z.string(),
    logoUrl: logoUrlSchema,
    logoSrcSet: logoSrcSetSchema,
  })
  .meta({ id: 'OrganizationSummary' });
export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;

export const collegeRefSchema = z
  .object({ code: z.string(), slug: slugSchema, name: z.string() })
  .meta({ id: 'CollegeRef' });
export type CollegeRef = z.infer<typeof collegeRefSchema>;

/** One entry of GET /colleges. */
export const collegeSummarySchema = z
  .object({
    code: z.string(),
    slug: slugSchema,
    name: z.string(),
    motto: z.string().nullable(),
    csc: organizationSummarySchema.nullable(),
  })
  .meta({ id: 'CollegeSummary' });
export type CollegeSummary = z.infer<typeof collegeSummarySchema>;

export const collegeListResponseSchema = z
  .object({ colleges: z.array(collegeSummarySchema) })
  .meta({ id: 'CollegeListResponse' });
export type CollegeListResponse = z.infer<typeof collegeListResponseSchema>;

/** The CSC as the college page shows it: its card carries the council's own description. */
export const cscProfileSchema = organizationSummarySchema
  .extend({ description: z.string().nullable() })
  .meta({ id: 'CscProfile' });
export type CscProfile = z.infer<typeof cscProfileSchema>;

/** GET /colleges/:slug: the college, its CSC and the CSC's SBOs. */
export const collegeDetailSchema = collegeSummarySchema
  .extend({
    description: z.string().nullable(),
    csc: cscProfileSchema.nullable(),
    sbos: z.array(organizationSummarySchema),
  })
  .meta({ id: 'CollegeDetail' });
export type CollegeDetail = z.infer<typeof collegeDetailSchema>;

/** What a profile link points to, from its host (`socialLinkOf` in profile.ts). */
export const SOCIAL_KINDS = [
  'facebook',
  'instagram',
  'tiktok',
  'youtube',
  'x',
  'linkedin',
  'website',
] as const;
export type SocialKind = (typeof SOCIAL_KINDS)[number];

export const socialLinkSchema = z
  .object({ url: z.url(), kind: z.enum(SOCIAL_KINDS), label: z.string() })
  .meta({ id: 'SocialLink' });
export type SocialLink = z.infer<typeof socialLinkSchema>;

/** An officer as the public page lists them: only entries the organization shows publicly. */
export const publicOfficerSchema = z
  .object({ position: z.string(), name: z.string() })
  .meta({ id: 'PublicOfficer' });
export type PublicOfficer = z.infer<typeof publicOfficerSchema>;

/**
 * GET /organizations/:slug. `id` lets a signed-in client match its roles to the page. The
 * profile fields are the organization's own (/dashboard/profile); hidden officers are never
 * included.
 */
export const organizationDetailSchema = organizationSummarySchema
  .extend({
    id: z.uuid(),
    description: z.string().nullable(),
    parent: organizationSummarySchema.nullable(),
    college: collegeRefSchema.nullable(),
    mission: z.string().nullable(),
    vision: z.string().nullable(),
    contactEmail: z.string().nullable(),
    /** The Facebook page first, then the other links in the organization's order. */
    links: z.array(socialLinkSchema),
    officers: z.array(publicOfficerSchema),
    coverUrl: logoUrlSchema,
    coverSrcSet: logoSrcSetSchema,
  })
  .meta({ id: 'OrganizationDetail' });
export type OrganizationDetail = z.infer<typeof organizationDetailSchema>;
