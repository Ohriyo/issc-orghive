import { z } from 'zod';
import { actingAsSchema } from './acting-as';
import { collegeRefSchema, socialLinkSchema, type SocialKind } from './public-read';
import { organizationTypeSchema } from './organization';
import { previewStatusSchema, scanStatusSchema } from './document';
import { uploadKeySchema } from './upload';

/*
 * The organization profile (/dashboard/profile). The organization's own account edits its
 * description, mission, vision, images, contact details, links and officers. Its official
 * name, acronym, type and college belong to the ISSC account (/admin) and are only shown.
 */

export const PROFILE_DESCRIPTION_MAX = 2000;
export const PROFILE_STATEMENT_MAX = 1000;
export const PROFILE_MAX_LINKS = 6;
export const PROFILE_MAX_OFFICERS = 30;

/** Covers: PNG, JPEG or WebP up to 5 MB, at least this wide. Stored as WebP (like logos). */
export const COVER_MAX_BYTES = 5 * 1024 * 1024;
export const COVER_MIN_WIDTH = 1200;

/** Blank text means "none": the form sends what is in the box, the database stores null. */
const blankToNull = (value: string | null) => (value === '' ? null : value);

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `Keep the ${label} to ${max} characters or fewer`)
    .nullable()
    .transform(blankToNull);

/** Blank or null is "none"; anything else must pass `schema` (its first message is shown). */
const optionalMatching = (schema: z.ZodType<string>) =>
  z
    .string()
    .trim()
    .nullable()
    .superRefine((value, ctx) => {
      if (!value) return;
      const result = schema.safeParse(value);
      if (!result.success) {
        ctx.addIssue({ code: 'custom', message: result.error.issues[0]?.message ?? 'Invalid' });
      }
    })
    .transform(blankToNull);

const httpsUrl = z
  .string()
  .trim()
  .max(300, 'Keep links to 300 characters or fewer')
  .pipe(z.url({ protocol: /^https$/, error: 'Enter a full link that starts with https://' }));

/** The host of an http(s) link without `www.`/`m.`, lowercased; '' when there is none. */
function hostOf(url: string): string {
  const host = /^https?:\/\/(?:[^@/?#]*@)?([^:/?#]+)/i.exec(url.trim())?.[1] ?? '';
  return host.toLowerCase().replace(/^(www|m|web)\./, '');
}

const FACEBOOK_HOSTS = ['facebook.com', 'fb.com', 'fb.me'];


const SOCIAL_HOSTS: Record<Exclude<SocialKind, 'website'>, { hosts: string[]; label: string }> = {
  facebook: { hosts: FACEBOOK_HOSTS, label: 'Facebook' },
  instagram: { hosts: ['instagram.com'], label: 'Instagram' },
  tiktok: { hosts: ['tiktok.com'], label: 'TikTok' },
  youtube: { hosts: ['youtube.com', 'youtu.be'], label: 'YouTube' },
  x: { hosts: ['x.com', 'twitter.com'], label: 'X' },
  linkedin: { hosts: ['linkedin.com'], label: 'LinkedIn' },
};

/** What a link is, from its host alone; anything unknown is the organization's website. */
export function socialLinkOf(url: string): { kind: SocialKind; label: string } {
  const host = hostOf(url);
  for (const [kind, { hosts, label }] of Object.entries(SOCIAL_HOSTS)) {
    if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
      return { kind: kind as SocialKind, label };
    }
  }
  return { kind: 'website', label: host || 'Website' };
}

export const facebookUrlSchema = httpsUrl.refine(
  (url) => socialLinkOf(url).kind === 'facebook',
  'Enter the link to a Facebook page, e.g. https://facebook.com/yourpage',
);

export const profileOfficerSchema = z.strictObject({
  position: z
    .string()
    .trim()
    .min(2, 'Enter the position, e.g. President')
    .max(80, 'Keep the position to 80 characters or fewer'),
  name: z
    .string()
    .trim()
    .min(2, 'Enter the officer’s name')
    .max(120, 'Keep the name to 120 characters or fewer'),
  /** Shown on the public organization page. On by default. */
  isPublic: z.boolean().default(true),
});
export type ProfileOfficer = z.infer<typeof profileOfficerSchema>;
export type ProfileOfficerInput = z.input<typeof profileOfficerSchema>;

/** The editable fields, as the form holds them (without who is acting). */
export const profileFieldsSchema = z.strictObject({
  description: optionalText(PROFILE_DESCRIPTION_MAX, 'description'),
  mission: optionalText(PROFILE_STATEMENT_MAX, 'mission'),
  vision: optionalText(PROFILE_STATEMENT_MAX, 'vision'),
  contactEmail: optionalMatching(
    z
      .email('Enter an email address, e.g. council@nwssu.edu.ph')
      .max(254, 'Keep the email to 254 characters or fewer'),
  ),
  facebookUrl: optionalMatching(facebookUrlSchema),
  links: z
    .array(httpsUrl)
    .max(PROFILE_MAX_LINKS, `Add at most ${PROFILE_MAX_LINKS} other links`)
    .refine((links) => new Set(links).size === links.length, 'Each link may appear once')
    .refine(
      (links) => links.every((url) => socialLinkOf(url).kind !== 'facebook'),
      'Put the Facebook page in its own field',
    ),
  officers: z
    .array(profileOfficerSchema)
    .max(PROFILE_MAX_OFFICERS, `List at most ${PROFILE_MAX_OFFICERS} officers`),
});
export type ProfileFields = z.infer<typeof profileFieldsSchema>;
export type ProfileFieldsInput = z.input<typeof profileFieldsSchema>;

/**
 * PUT /organizations/:slug/profile: every editable field at once (the editor saves the whole
 * form), plus who is acting for the account. Audited.
 */
export const updateProfileRequestSchema = profileFieldsSchema.extend({ actingAs: actingAsSchema });
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

/** The header that carries "Acting as" on the raw image uploads (logo and cover), percent-encoded. */
export const ACTING_AS_HEADER = 'X-Orghive-Acting-As';

/** GET /organizations/:slug/profile: what the editor loads (the owning account only). */
export const organizationProfileSchema = z
  .object({
    slug: z.string(),
    /** Managed by the ISSC account in /admin; shown, never edited here. */
    official: z.object({
      name: z.string(),
      acronym: z.string(),
      type: organizationTypeSchema,
      college: collegeRefSchema.nullable(),
    }),
    description: z.string().nullable(),
    mission: z.string().nullable(),
    vision: z.string().nullable(),
    contactEmail: z.string().nullable(),
    facebookUrl: z.string().nullable(),
    links: z.array(socialLinkSchema),
    /** Every officer, hidden ones included, in the organization's order. */
    officers: z.array(profileOfficerSchema.extend({ isPublic: z.boolean() })),
    logoUrl: z.url().nullable(),
    coverUrl: z.url().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'OrganizationProfile' });
export type OrganizationProfile = z.infer<typeof organizationProfileSchema>;

/* -------------------------------------------------------------------------------------------
 * Constitution & By-laws: one per organization, always public, always view-only for everyone
 * but the owning account. Amended by uploading a new version with a note and the date it was
 * amended; older versions stay in its history and can be viewed by anyone. It is never
 * archived or deleted (docs/DOMAIN_RULES.md, "Constitution & By-laws").
 * ----------------------------------------------------------------------------------------- */

export const CONSTITUTION_DOCUMENT_TYPE = {
  slug: 'constitution-by-laws',
  name: 'Constitution & By-laws',
};
export const CONSTITUTION_TITLE = 'Constitution & By-laws';
export const CONSTITUTION_NOTE_MAX = 280;

/**
 * POST /organizations/:slug/constitution: a file already PUT with an upload URL. The first
 * upload is the adopted constitution (note optional); every later one is an amendment and
 * needs a note saying what changed. `amendedOn` is the Manila date it was adopted or amended,
 * which is often before the upload; never in the future (checked by the server's clock).
 */
export const uploadConstitutionRequestSchema = z.strictObject({
  uploadKey: uploadKeySchema,
  actingAs: actingAsSchema,
  amendedOn: z.iso.date('Enter the date it was adopted or amended'),
  note: optionalText(CONSTITUTION_NOTE_MAX, 'note').optional(),
});
export type UploadConstitutionRequest = z.infer<typeof uploadConstitutionRequestSchema>;

export const constitutionVersionSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int(),
    /** Manila date adopted (version 1) or amended. */
    amendedOn: z.iso.date().nullable(),
    note: z.string().nullable(),
    isCurrent: z.boolean(),
    uploadedAt: z.iso.datetime(),
    /** Owner only: still being scanned, or refused. Everyone else sees clean versions. */
    scanStatus: scanStatusSchema,
    previewStatus: previewStatusSchema,
    /** Owner only; null for everyone else. */
    actingAs: z.string().nullable(),
  })
  .meta({ id: 'ConstitutionVersion' });
export type ConstitutionVersion = z.infer<typeof constitutionVersionSchema>;

/**
 * GET /organizations/:slug/constitution. `constitution` is null until one has passed the scan
 * (for the owning account: until one was uploaded at all).
 */
export const constitutionResponseSchema = z
  .object({
    constitution: z
      .object({
        documentId: z.uuid(),
        /** The current version's date: "Last amended …" (or "Adopted …" for version 1). */
        lastAmendedOn: z.iso.date().nullable(),
        versions: z.array(constitutionVersionSchema),
      })
      .nullable(),
  })
  .meta({ id: 'ConstitutionResponse' });
export type ConstitutionResponse = z.infer<typeof constitutionResponseSchema>;
