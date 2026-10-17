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

/**
 * What the dashboard counts per organization, among the documents the user may see:
 * available documents by visibility, then the other lifecycle states. Deleted documents are
 * not counted.
 */
export const documentCountsSchema = z.object({
  public: z.number().int().nonnegative(),
  members: z.number().int().nonnegative(),
  private: z.number().int().nonnegative(),
  scanning: z.number().int().nonnegative(),
  quarantined: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
});
export type DocumentCounts = z.infer<typeof documentCountsSchema>;

export const DASHBOARD_ACTIVITY_KINDS = [
  'upload',
  'quarantine',
  'archive',
  'restore',
  'visibility_change',
] as const;
export const dashboardActivityKindSchema = z.enum(DASHBOARD_ACTIVITY_KINDS);
export type DashboardActivityKind = z.infer<typeof dashboardActivityKindSchema>;

/** One upload, scan result, archive or visibility change in an organization, from the audit log. */
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
  counts: documentCountsSchema,
  /** The 5 most recently created documents, any status. */
  recentDocuments: z.array(documentSummarySchema),
  /** The user's own uploads the virus scan refused, most recent first. */
  quarantined: z.array(documentSummarySchema),
  /** The latest activity, newest first. */
  activity: z.array(dashboardActivitySchema),
});
export type DashboardOrganization = z.infer<typeof dashboardOrganizationSchema>;

/** GET /me/dashboard: the signed-in user's own organizations only. */
export const dashboardResponseSchema = z
  .object({
    memberships: z.array(dashboardMembershipSchema),
    organizations: z.array(dashboardOrganizationSchema),
    /** An ISSC admin: the dashboard links to /admin. */
    isAdmin: z.boolean(),
  })
  .meta({ id: 'DashboardResponse' });
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
