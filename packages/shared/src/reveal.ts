import { z } from 'zod';
import { officerInChargeSchema } from './auth';
import { organizationTypeSchema } from './organization';

/*
 * The one-time Reveal (docs/DOMAIN_RULES.md, "Accounts"). Temporary passwords for
 * organization accounts are stored only as hashes; one encrypted copy goes to the ISSC
 * account, shown once behind "Reveal", then erased. Unrevealed copies are erased after
 * REVEAL_TTL_DAYS.
 */

export const REVEAL_TTL_DAYS = 7;

/** Why the passwords were issued. */
export const REVEAL_PURPOSES = [
  'account_created',
  'password_reset',
  'bulk_created',
  'end_of_term',
] as const;
export const revealPurposeSchema = z.enum(REVEAL_PURPOSES);
export type RevealPurpose = z.infer<typeof revealPurposeSchema>;

export const revealIdParamsSchema = z.object({ revealId: z.uuid() });

/** GET /me/reveals/:revealId: what it holds, never the passwords. */
export const revealStatusSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(['available', 'revealed', 'expired']),
    purpose: revealPurposeSchema,
    entryCount: z.number().int().min(1),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    revealedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'RevealStatus' });
export type RevealStatus = z.infer<typeof revealStatusSchema>;

/** One account's temporary password, for the ISSC to hand to its officer in charge. */
export const revealEntrySchema = z.object({
  organization: z.object({
    acronym: z.string(),
    name: z.string(),
    type: organizationTypeSchema,
  }),
  email: z.email(),
  temporaryPassword: z.string(),
  officerInCharge: officerInChargeSchema.nullable(),
});
export type RevealEntry = z.infer<typeof revealEntrySchema>;

/** POST /me/reveals/:revealId/reveal: once only; 410 afterwards or once expired. */
export const revealResponseSchema = z
  .object({ entries: z.array(revealEntrySchema).min(1) })
  .meta({ id: 'RevealResponse' });
export type RevealResponse = z.infer<typeof revealResponseSchema>;
