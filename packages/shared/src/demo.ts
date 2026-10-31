import { z } from 'zod';

/*
 * Demo data (pnpm --filter api db:seed:demo): sample activity so empty features can be shown
 * during development and demos. Every demo row has is_demo = true and every demo file sits
 * under DEMO_STORAGE_PREFIX; all of it is removed before deployment (db:unseed:demo, or the
 * super admin console), and the API refuses to start in production while any remains.
 */

/** Where demo files are stored. Nothing else is ever written under it. */
export const DEMO_STORAGE_PREFIX = 'demo/';

/** What the demo data is counted by, in the order the console lists it. */
export const DEMO_DATA_KINDS = [
  'organizations',
  'accounts',
  'projects',
  'projectTasks',
  'projectTaskFiles',
  'documents',
  'documentVersions',
  'financialFigures',
  'appeals',
  'freezes',
  'notifications',
  'announcements',
  'leaderboardSnapshots',
  'auditLogs',
] as const;
export type DemoDataKind = (typeof DEMO_DATA_KINDS)[number];

export const DEMO_DATA_LABELS: Record<DemoDataKind, string> = {
  organizations: 'Organizations',
  accounts: 'Accounts',
  projects: 'Projects',
  projectTasks: 'Project tasks',
  projectTaskFiles: 'Task files',
  documents: 'Documents',
  documentVersions: 'Document versions',
  financialFigures: 'Financial figures',
  appeals: 'Appeals',
  freezes: 'Freezes',
  notifications: 'Notifications',
  announcements: 'Announcements',
  leaderboardSnapshots: 'Leaderboard snapshots',
  auditLogs: 'Audit log entries',
};

export const demoDataCountsSchema = z.object(
  Object.fromEntries(DEMO_DATA_KINDS.map((kind) => [kind, z.number().int().min(0)])) as Record<
    DemoDataKind,
    z.ZodNumber
  >,
);
export type DemoDataCounts = z.infer<typeof demoDataCountsSchema>;

/** GET /system/demo-data: how much demo data there is, before removing it. */
export const demoDataPreviewSchema = z
  .object({
    /** Rows flagged is_demo, over every kind. */
    total: z.number().int().min(0),
    counts: demoDataCountsSchema,
  })
  .meta({ id: 'DemoDataPreview' });
export type DemoDataPreview = z.infer<typeof demoDataPreviewSchema>;

/**
 * POST /system/demo-data/delete: removes every demo row and file. `expectedTotal` is the total
 * the preview showed; if it changed since, nothing is removed (409) and the preview is shown
 * again.
 */
export const removeDemoDataRequestSchema = z.strictObject({
  expectedTotal: z.number().int().min(1),
});
export type RemoveDemoDataRequest = z.infer<typeof removeDemoDataRequestSchema>;

export const removeDemoDataResponseSchema = z
  .object({
    /** Flagged rows removed, by kind (rows the app derived from them are not counted). */
    removed: demoDataCountsSchema,
    /** Objects deleted from storage: the demo files and their page images. */
    files: z.number().int().min(0),
  })
  .meta({ id: 'RemoveDemoDataResponse' });
export type RemoveDemoDataResponse = z.infer<typeof removeDemoDataResponseSchema>;

/**
 * GET /demo-status (public): which organizations' public pages show demo data, so they can
 * carry a "Sample data" chip. Empty when there is none or SHOW_DEMO_BADGE is off.
 */
export const demoStatusSchema = z
  .object({
    /** Slugs of the SBOs and CSCs with demo projects (or that are demo organizations). */
    organizations: z.array(z.string()),
  })
  .meta({ id: 'DemoStatus' });
export type DemoStatus = z.infer<typeof demoStatusSchema>;
