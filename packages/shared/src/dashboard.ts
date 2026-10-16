import { z } from 'zod';
import { documentSummarySchema } from './document';
import { membershipRoleSchema } from './organization';
import { organizationSummarySchema } from './public-read';

/** A term within this many days of ending is flagged on the dashboard. */
export const TERM_ENDING_SOON_DAYS = 14;

/** One active membership of the signed-in user. A user can hold several in one organization. */
export const dashboardMembershipSchema = z.object({
  organizationId: z.uuid(),
  role: membershipRoleSchema,
  isHead: z.boolean(),
  /** "President", "Governor", "Adviser"... */
  title: z.string().nullable(),
  /** Last day of the term, `YYYY-MM-DD`; null when open-ended (admins). */
  termEnd: z.iso.date().nullable(),
});
export type DashboardMembership = z.infer<typeof dashboardMembershipSchema>;

/** Document counts by status. Deleted documents are not counted. */
export const documentStatusCountsSchema = z.object({
  draft: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  approved: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
});
export type DocumentStatusCounts = z.infer<typeof documentStatusCountsSchema>;

/** A rejected document with the reviewer's latest decision on it. */
export const rejectedDocumentSchema = z.object({
  document: documentSummarySchema,
  /** The reviewer's comment; optional until the school decides (docs/DOMAIN_RULES.md). */
  remark: z.string().nullable(),
  reviewerName: z.string().nullable(),
  decidedAt: z.iso.datetime().nullable(),
});
export type RejectedDocument = z.infer<typeof rejectedDocumentSchema>;

export const DASHBOARD_ACTIVITY_KINDS = [
  'upload',
  'approve',
  'reject',
  'quarantine',
  'archive',
  'restore',
] as const;
export const dashboardActivityKindSchema = z.enum(DASHBOARD_ACTIVITY_KINDS);
export type DashboardActivityKind = z.infer<typeof dashboardActivityKindSchema>;

/** One upload or decision in an organization, from the audit log. */
export const dashboardActivitySchema = z.object({
  id: z.uuid(),
  kind: dashboardActivityKindSchema,
  at: z.iso.datetime(),
  /** Null for the system (the virus-scan worker). */
  actorName: z.string().nullable(),
  /** Null when the document has since been deleted. */
  document: z.object({ id: z.uuid(), title: z.string() }).nullable(),
  version: z.number().int().nullable(),
});
export type DashboardActivity = z.infer<typeof dashboardActivitySchema>;

/** Everything the dashboard shows for one of the user's organizations. */
export const dashboardOrganizationSchema = z.object({
  organization: organizationSummarySchema.extend({ id: z.uuid() }),
  counts: documentStatusCountsSchema,
  /** The 5 most recently created documents, any status. */
  recentDocuments: z.array(documentSummarySchema),
  /** Rejected documents, newest decision first, with the reviewer's remarks. */
  needsRevision: z.array(rejectedDocumentSchema),
  /** The latest uploads and decisions, newest first. */
  activity: z.array(dashboardActivitySchema),
});
export type DashboardOrganization = z.infer<typeof dashboardOrganizationSchema>;

/** GET /me/dashboard: the signed-in user's own organizations only. */
export const dashboardResponseSchema = z
  .object({
    memberships: z.array(dashboardMembershipSchema),
    organizations: z.array(dashboardOrganizationSchema),
    /**
     * Present when the user reviews another organization's documents (approval chain in
     * docs/DOMAIN_RULES.md): how many are waiting. Null for everyone else.
     */
    reviews: z
      .object({ pending: z.number().int().nonnegative(), organizations: z.number().int() })
      .nullable(),
    /** An ISSC admin: the dashboard links to /admin. */
    isAdmin: z.boolean(),
  })
  .meta({ id: 'DashboardResponse' });
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
