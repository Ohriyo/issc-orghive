import { z } from 'zod';
import { academicYearSchema, semesterSchema } from './academic-term';
import { standingsStatusSchema } from './leaderboard';

/*
 * GET /organizations/:slug/showcase (public): what /orgs/:slug shows beside the profile and the
 * posts, all derived from records the organization already keeps (docs/DOMAIN_RULES.md,
 * "Organization page"):
 * - its rank badge: top 10 on its board (SBO or CSC), never the ISSC; once standings are final
 *   it keeps the final rank until the next semester starts;
 * - its completed projects, newest first, grouped by semester (the semester calendar decides
 *   which), each linking only to its task files that are public;
 * - its newest public documents and how many public documents it has.
 * The same for every viewer: the owner's private files never appear here.
 */

/** Only these places earn a badge. */
export const SHOWCASE_RANK_MAX = 10;
/** Completed projects the page receives at most (it shows the first few, then expands). */
export const SHOWCASE_PROJECTS_MAX = 60;
/** Completed projects shown before "Show N earlier projects". */
export const SHOWCASE_PROJECTS_SHOWN = 3;
/** Newest public documents under the constitution. */
export const SHOWCASE_DOCUMENTS = 3;

export const showcaseRankSchema = z
  .object({
    board: z.enum(['SBO', 'CSC']),
    rank: z.number().int().min(1).max(SHOWCASE_RANK_MAX),
    academicYear: academicYearSchema,
    semester: semesterSchema,
    status: standingsStatusSchema,
  })
  .meta({ id: 'ShowcaseRank' });
export type ShowcaseRank = z.infer<typeof showcaseRankSchema>;

/** A public file of a project: its task's label (or the file's own label) and the document. */
export const showcaseProjectFileSchema = z.object({
  documentId: z.uuid(),
  label: z.string(),
});
export type ShowcaseProjectFile = z.infer<typeof showcaseProjectFileSchema>;

export const showcaseProjectSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  /** The event date, a Manila calendar date. */
  date: z.iso.date(),
  location: z.string(),
  beneficiaries: z.string(),
  /** Public task files only, in checklist order; empty says "No public documents". */
  files: z.array(showcaseProjectFileSchema),
});
export type ShowcaseProject = z.infer<typeof showcaseProjectSchema>;

export const showcaseSemesterSchema = z.object({
  academicYear: academicYearSchema,
  semester: semesterSchema,
  projects: z.array(showcaseProjectSchema),
});
export type ShowcaseSemester = z.infer<typeof showcaseSemesterSchema>;

export const showcaseDocumentSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  typeName: z.string(),
  createdAt: z.iso.datetime(),
});
export type ShowcaseDocument = z.infer<typeof showcaseDocumentSchema>;

export const orgShowcaseSchema = z
  .object({
    rank: showcaseRankSchema.nullable(),
    /** Newest semester first; projects newest first within each. */
    projectSemesters: z.array(showcaseSemesterSchema),
    /** Newest first, the constitution and handbook left out (shown on their own). */
    documents: z.array(showcaseDocumentSchema),
    publicDocumentCount: z.number().int().min(0),
  })
  .meta({ id: 'OrgShowcase' });
export type OrgShowcase = z.infer<typeof orgShowcaseSchema>;
