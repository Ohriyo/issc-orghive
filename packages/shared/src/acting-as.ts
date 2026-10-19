import { z } from 'zod';

/*
 * "Acting as" (docs/DOMAIN_RULES.md, "Accounts"): an organization's officers share one
 * account, so every upload, archive and deletion names the officer who did it. It is stored
 * on the version and in the audit log, shown to the organization's own account and the super
 * admin, and never on public pages.
 */

export const ACTING_AS_MIN_LENGTH = 2;
export const ACTING_AS_MAX_LENGTH = 80;

export const actingAsSchema = z
  .string({ error: 'Enter your name: who is acting for the account' })
  .trim()
  .min(ACTING_AS_MIN_LENGTH, 'Enter your name: who is acting for the account')
  .max(ACTING_AS_MAX_LENGTH, `Keep the name to ${ACTING_AS_MAX_LENGTH} characters or fewer`);

/** The body of archive and delete requests: only who is acting. */
export const actingAsRequestSchema = z.strictObject({ actingAs: actingAsSchema });
export type ActingAsRequest = z.infer<typeof actingAsRequestSchema>;
