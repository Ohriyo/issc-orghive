import { z } from 'zod';
import { organizationTypeSchema, slugSchema } from './organization';

/** Route params for every `/:slug` public read. */
export const slugParamsSchema = z.object({ slug: slugSchema });
export type SlugParams = z.infer<typeof slugParamsSchema>;

/** Public, CDN-cacheable logo URL, or null when the organization has no logo. */
const logoUrlSchema = z.url().nullable().meta({ description: 'Public logo URL (CDN-cacheable)' });

export const organizationSummarySchema = z
  .object({
    type: organizationTypeSchema,
    slug: slugSchema,
    acronym: z.string(),
    name: z.string(),
    logoUrl: logoUrlSchema,
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

/** GET /organizations/:slug. */
export const organizationDetailSchema = organizationSummarySchema
  .extend({
    description: z.string().nullable(),
    parent: organizationSummarySchema.nullable(),
    college: collegeRefSchema.nullable(),
  })
  .meta({ id: 'OrganizationDetail' });
export type OrganizationDetail = z.infer<typeof organizationDetailSchema>;
