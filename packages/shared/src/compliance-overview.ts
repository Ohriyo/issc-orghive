import { z } from 'zod';
import { academicYearSchema, semesterSchema } from './academic-term';
import { organizationTypeSchema, slugSchema } from './organization';
import { taskFileIntegritySchema } from './integrity';
import { projectStatusSchema, projectTaskTypeSchema } from './project';

/*
 * The compliance overview (docs/DOMAIN_RULES.md, "Updates and compliance overview"):
 * read-only, from the F11 project data. A CSC's officers and advisers see their college's
 * SBOs; the ISSC's, and ISSC admins, see every CSC and SBO.
 */

/** GET /compliance/overview. Both or neither: without them, the current semester. */
export const complianceOverviewQuerySchema = z
  .object({
    academicYear: academicYearSchema.optional(),
    semester: semesterSchema.optional(),
  })
  .refine(
    (q) => (q.academicYear === undefined) === (q.semester === undefined),
    'Give both academicYear and semester, or neither',
  );
export type ComplianceOverviewQuery = z.infer<typeof complianceOverviewQuerySchema>;

/** A task deadline, linked to its project. */
export const taskDeadlineSchema = z.object({
  projectId: z.uuid(),
  projectName: z.string(),
  task: projectTaskTypeSchema,
  dueAt: z.iso.datetime(),
});
export type TaskDeadline = z.infer<typeof taskDeadlineSchema>;

/**
 * A task file its governing bodies should look at (spec section 6): its checks warn and
 * nobody cleared them, or a governing body flagged it. Only files shared with them (public
 * or governing) are listed: a private file is never shown, and never ranked.
 */
export const attentionFileSchema = z.object({
  documentId: z.uuid(),
  title: z.string(),
  projectId: z.uuid(),
  projectName: z.string(),
  task: projectTaskTypeSchema,
  /** A Communication Letter's label; null for one-file tasks. */
  label: z.string().nullable(),
  integrity: taskFileIntegritySchema,
});
export type AttentionFile = z.infer<typeof attentionFileSchema>;

export const complianceRowSchema = z
  .object({
    organization: z.object({
      type: organizationTypeSchema,
      slug: slugSchema,
      acronym: z.string(),
      name: z.string(),
      /** The college code; null for the ISSC. */
      college: z.string().nullable(),
    }),
    /** This semester's projects that are still running. */
    activeProjects: z.number().int().nonnegative(),
    /** This semester's projects blocked by a late proposal. */
    blockedProjects: z.array(z.object({ id: z.uuid(), name: z.string() })),
    /** The earliest deadline still ahead of an open task, this semester. */
    nextDeadline: taskDeadlineSchema.nullable(),
    /** This semester's tasks past their deadline and not submitted, oldest first. */
    overdueTasks: z.array(taskDeadlineSchema.extend({ daysOverdue: z.number().int().positive() })),
    /** Whatever the semester: since when the organization is frozen, or null. */
    frozenSince: z.iso.datetime().nullable(),
    /** Whatever the semester: appeals not decided yet. */
    openAppeals: z.number().int().nonnegative(),
    /** This semester's task files needing attention or flagged invalid, oldest project first. */
    attentionFiles: z.array(attentionFileSchema),
  })
  .meta({ id: 'ComplianceRow' });
export type ComplianceRow = z.infer<typeof complianceRowSchema>;

export const complianceOverviewSchema = z
  .object({
    academicYear: academicYearSchema,
    semester: semesterSchema,
    /** Whose overview: a CSC's (its college's SBOs) or the ISSC's (every CSC and SBO). */
    scope: z.object({ type: z.enum(['CSC', 'ISSC']), acronym: z.string() }),
    organizations: z.array(complianceRowSchema),
  })
  .meta({ id: 'ComplianceOverview' });
export type ComplianceOverview = z.infer<typeof complianceOverviewSchema>;

/** "Most overdue": the oldest overdue task first, then the most overdue tasks, then name. */
export function compareMostOverdue(a: ComplianceRow, b: ComplianceRow): number {
  const oldest = (row: ComplianceRow) => row.overdueTasks[0]?.daysOverdue ?? 0;
  return (
    oldest(b) - oldest(a) ||
    b.overdueTasks.length - a.overdueTasks.length ||
    a.organization.acronym.localeCompare(b.organization.acronym)
  );
}

/** "This semester" on the dashboard, for an organization the user is an officer of. */
export const semesterSummarySchema = z.object({
  academicYear: academicYearSchema,
  semester: semesterSchema,
  counts: z.record(projectStatusSchema, z.number().int().nonnegative()),
  /** The next three deadlines ahead of open tasks, soonest first. */
  nextDeadlines: z.array(taskDeadlineSchema).max(3),
});
export type SemesterSummary = z.infer<typeof semesterSummarySchema>;
