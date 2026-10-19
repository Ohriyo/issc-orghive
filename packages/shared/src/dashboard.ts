import { z } from 'zod';
import { semesterSummarySchema } from './compliance-overview';
import { documentSummarySchema } from './document';
import { officerInChargeSchema } from './auth';
import { organizationSummarySchema } from './public-read';

/** A term within this many days of ending is flagged on the dashboard. */
export const TERM_ENDING_SOON_DAYS = 14;

/** The shared account's current term: who answers for it, and until when. */
export const dashboardTermSchema = z.object({
  officerInCharge: officerInChargeSchema,
  /** Last day of the term, `YYYY-MM-DD`; null when open-ended. */
  termEnd: z.iso.date().nullable(),
});
export type DashboardTerm = z.infer<typeof dashboardTermSchema>;

/**
 * What the dashboard counts per organization, among the documents the user may see:
 * available documents by visibility, then the other lifecycle states. Deleted documents are
 * not counted.
 */
export const documentCountsSchema = z.object({
  public: z.number().int().nonnegative(),
  governing: z.number().int().nonnegative(),
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
  /** The officer who acted for the account, when the entry recorded one. */
  actingAs: z.string().nullable(),
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
  /** This semester's projects and next deadlines. */
  semester: semesterSummarySchema.nullable(),
});
export type DashboardOrganization = z.infer<typeof dashboardOrganizationSchema>;

/**
 * GET /me/dashboard: the shared account's own organization (one, or none for an account that
 * belongs to none). The flags come from the server, so the web never re-derives a rule.
 */
export const dashboardResponseSchema = z
  .object({
    /** The current term; null when no officer-in-charge is on record. */
    term: dashboardTermSchema.nullable(),
    organizations: z.array(dashboardOrganizationSchema),
    /** The ISSC account: the dashboard links to /admin. */
    isIssc: z.boolean(),
    /** A CSC or the ISSC: links to the compliance overview. */
    canSeeCompliance: z.boolean(),
    /** A CSC or the ISSC: decides appeals (appeal-rules.ts), so the dashboard links to them. */
    decidesAppeals: z.boolean(),
  })
  .meta({ id: 'DashboardResponse' });
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
