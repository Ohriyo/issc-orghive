import { z } from 'zod';
import { organizationTypeSchema, slugSchema } from './organization';

/*
 * /admin: ISSC admins manage colleges and organizations (docs/DOMAIN_RULES.md,
 * "Administration"). Slugs are fixed once created, because shared links use them.
 */

const nameSchema = z.string().trim().min(3).max(160);
const acronymSchema = z.string().trim().min(2).max(24);
const descriptionSchema = z.string().trim().max(2000);

/** "CEA", "CoED": letters only, as the colleges write them. */
export const collegeCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2,10}$/, 'Use 2 to 10 letters, e.g. CEA');

export const createCollegeRequestSchema = z.strictObject({
  code: collegeCodeSchema,
  slug: slugSchema,
  name: nameSchema,
  motto: z.string().trim().max(200).optional(),
  description: descriptionSchema.optional(),
});
export type CreateCollegeRequest = z.infer<typeof createCollegeRequestSchema>;

/** At least one field; `null` clears an optional one. The slug never changes. */
export const updateCollegeRequestSchema = z
  .strictObject({
    code: collegeCodeSchema,
    name: nameSchema,
    motto: z.string().trim().max(200).nullable(),
    description: descriptionSchema.nullable(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Change at least one field');
export type UpdateCollegeRequest = z.infer<typeof updateCollegeRequestSchema>;

/**
 * A new CSC or SBO. There is exactly one ISSC, so it is never created here. A CSC belongs to
 * its college (one per college); an SBO belongs to its college's CSC.
 */
export const createOrganizationRequestSchema = z.strictObject({
  type: z.enum(['CSC', 'SBO']),
  collegeSlug: slugSchema,
  slug: slugSchema,
  acronym: acronymSchema,
  name: nameSchema,
  description: descriptionSchema.optional(),
});
export type CreateOrganizationRequest = z.infer<typeof createOrganizationRequestSchema>;

export const updateOrganizationRequestSchema = z
  .strictObject({
    acronym: acronymSchema,
    name: nameSchema,
    description: descriptionSchema.nullable(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Change at least one field');
export type UpdateOrganizationRequest = z.infer<typeof updateOrganizationRequestSchema>;

/**
 * PUT /admin/colleges/order and PUT /admin/colleges/:slug/organizations/order: every
 * college (or every SBO of that college), in the new carousel order.
 */
export const reorderRequestSchema = z.strictObject({
  slugs: z
    .array(slugSchema)
    .min(1)
    .max(200)
    .refine((slugs) => new Set(slugs).size === slugs.length, 'Each slug may appear once'),
});
export type ReorderRequest = z.infer<typeof reorderRequestSchema>;

/** Logos: PNG, JPEG or WebP up to 2 MB, at least this wide. Stored as WebP. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_MIN_WIDTH = 128;
export const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Account requests (account-request.ts): the ISSC asks, the super admin creates or declines. */
export const ACCOUNT_REQUEST_STATUSES = ['requested', 'created', 'declined'] as const;
export const accountRequestStatusSchema = z.enum(ACCOUNT_REQUEST_STATUSES);
export type AccountRequestStatus = z.infer<typeof accountRequestStatusSchema>;

/** An organization's latest account request, as /admin shows it on its row. */
export const accountRequestSummarySchema = z.object({
  id: z.uuid(),
  status: accountRequestStatusSchema,
  requestedAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  declineReason: z.string().nullable(),
});
export type AccountRequestSummary = z.infer<typeof accountRequestSummarySchema>;

export const adminOrganizationSchema = z
  .object({
    type: organizationTypeSchema,
    slug: slugSchema,
    acronym: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    logoUrl: z.url().nullable(),
    /** False while deactivated: hidden from browsing, no uploads or new projects. */
    active: z.boolean(),
    documentCount: z.number().int(),
    /** It has an active shared account (docs/DOMAIN_RULES.md, "Accounts"). */
    hasAccount: z.boolean(),
    /** Its latest account request, if any (the ISSC asks the super admin for accounts). */
    accountRequest: accountRequestSummarySchema.nullable(),
  })
  .meta({ id: 'AdminOrganization' });
export type AdminOrganization = z.infer<typeof adminOrganizationSchema>;

export const adminCollegeSchema = z
  .object({
    code: z.string(),
    slug: slugSchema,
    name: z.string(),
    motto: z.string().nullable(),
    description: z.string().nullable(),
    csc: adminOrganizationSchema.nullable(),
    /** In carousel order. */
    sbos: z.array(adminOrganizationSchema),
  })
  .meta({ id: 'AdminCollege' });
export type AdminCollege = z.infer<typeof adminCollegeSchema>;

/** GET /admin/organizations: the whole hierarchy, colleges in carousel order. */
export const adminOrganizationTreeSchema = z
  .object({
    issc: adminOrganizationSchema.nullable(),
    colleges: z.array(adminCollegeSchema),
  })
  .meta({ id: 'AdminOrganizationTree' });
export type AdminOrganizationTree = z.infer<typeof adminOrganizationTreeSchema>;
