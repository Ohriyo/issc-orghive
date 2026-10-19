import { z } from 'zod';
import { ACCOUNT_REQUEST_STATUSES, accountRequestStatusSchema } from './admin';
import { officerInChargeSchema } from './auth';
import { organizationTypeSchema } from './organization';
import { accountEmailSchema, officerInChargeInputSchema } from './system-accounts';

/*
 * Account requests (docs/DOMAIN_RULES.md, "Accounts"): the ISSC account asks for an
 * organization's account from /admin; the super admin creates it (its temporary password
 * goes to the ISSC account's one-time Reveal) or declines with a reason. One open request per
 * organization, and none for an organization that already has an active account.
 */

export const accountRequestIdParamsSchema = z.object({ requestId: z.uuid() });

/** POST /admin/organizations/:slug/account-request (the ISSC account). */
export const requestAccountRequestSchema = z.strictObject({
  accountEmail: accountEmailSchema,
  officerInCharge: officerInChargeInputSchema,
  note: z.string().trim().max(500).optional(),
});
export type RequestAccountRequest = z.infer<typeof requestAccountRequestSchema>;

/** One request in the super admin's queue. */
export const systemAccountRequestSchema = z
  .object({
    id: z.uuid(),
    status: accountRequestStatusSchema,
    organization: z.object({
      slug: z.string(),
      acronym: z.string(),
      name: z.string(),
      type: organizationTypeSchema,
      /** The college's slug (null for the ISSC), to prefill the create form. */
      collegeSlug: z.string().nullable(),
      college: z.string().nullable(),
      /** It got an active account meanwhile (another way): the request can only be declined. */
      hasAccount: z.boolean(),
    }),
    accountEmail: z.email(),
    officerInCharge: officerInChargeSchema,
    note: z.string().nullable(),
    requestedAt: z.iso.datetime(),
    requestedBy: z.object({ name: z.string(), email: z.email() }).nullable(),
    decidedAt: z.iso.datetime().nullable(),
    declineReason: z.string().nullable(),
    createdAccountId: z.uuid().nullable(),
  })
  .meta({ id: 'SystemAccountRequest' });
export type SystemAccountRequest = z.infer<typeof systemAccountRequestSchema>;

/** GET /system/account-requests?status= (open ones by default). */
export const systemAccountRequestListQuerySchema = z.object({
  status: z.enum([...ACCOUNT_REQUEST_STATUSES, 'all']).default('requested'),
});

export const systemAccountRequestListSchema = z
  .object({ items: z.array(systemAccountRequestSchema), openCount: z.number().int().min(0) })
  .meta({ id: 'SystemAccountRequestList' });
export type SystemAccountRequestList = z.infer<typeof systemAccountRequestListSchema>;

/** GET /system/account-requests/count: the sidebar badge. */
export const accountRequestCountSchema = z
  .object({ open: z.number().int().min(0) })
  .meta({ id: 'AccountRequestCount' });

/** POST /system/account-requests/:requestId/decline */
export const declineAccountRequestSchema = z.strictObject({
  reason: z.string().trim().min(5, 'Say why, so the ISSC can fix it').max(500),
});
export type DeclineAccountRequest = z.infer<typeof declineAccountRequestSchema>;
