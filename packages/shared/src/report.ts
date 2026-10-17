import { z } from 'zod';
import { academicYearSchema, semesterSchema, type Semester } from './academic-term';

/**
 * The Semestral End Report (docs/PROJECT_WORKFLOW_SPEC.md, section 4): every submitted task
 * file of an organization's projects in one semester, merged into one PDF.
 *
 * Semesters are fixed date ranges until an academic calendar exists (provisional,
 * docs/DOMAIN_RULES.md, 2026-10-17). The academic year starts in August, as academicYearOf.
 * A project belongs to the semester that contains its target date.
 */
export const SEMESTER_LABELS: Record<Semester, string> = {
  first: '1st semester',
  second: '2nd semester',
  midyear: 'Midyear',
};

/** The semester a Manila calendar date (`YYYY-MM-DD`) falls in. */
export function semesterOf(isoDate: string): Semester {
  const month = Number(isoDate.slice(5, 7));
  if (month >= 8) return 'first';
  if (month <= 5) return 'second';
  return 'midyear';
}

/** First and last day (`YYYY-MM-DD`, inclusive) of a semester of an academic year. */
export function semesterRange(
  academicYear: string,
  semester: Semester,
): { start: string; end: string } {
  const start = Number(academicYear.slice(0, 4));
  const next = start + 1;
  if (semester === 'first') return { start: `${start}-08-01`, end: `${start}-12-31` };
  if (semester === 'second') return { start: `${next}-01-01`, end: `${next}-05-31` };
  return { start: `${next}-06-01`, end: `${next}-07-31` };
}

/** The Paperworks document type the generated PDF is filed as (the migration seeds it). */
export const REPORT_DOCUMENT_TYPE = { slug: 'semestral-end-report', name: 'Semestral End Report' };

/** POST /organizations/:slug/semestral-reports */
export const generateReportRequestSchema = z.strictObject({
  academicYear: academicYearSchema,
  semester: semesterSchema,
});
export type GenerateReportRequest = z.infer<typeof generateReportRequestSchema>;

/** queued -> generating -> ready | failed. */
export const REPORT_STATUSES = ['queued', 'generating', 'ready', 'failed'] as const;
export const reportStatusSchema = z.enum(REPORT_STATUSES);
export type ReportStatus = z.infer<typeof reportStatusSchema>;

export const semestralReportSchema = z
  .object({
    id: z.uuid(),
    academicYear: z.string(),
    semester: semesterSchema,
    status: reportStatusSchema,
    /** 0-100 while generating. */
    progress: z.number().int().min(0).max(100),
    /** Why it failed, in words for the officer. */
    error: z.string().nullable(),
    requestedBy: z.object({ name: z.string() }),
    createdAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
    /** The generated PDF, a private document of the organization, once ready. */
    document: z
      .object({
        id: z.uuid(),
        title: z.string(),
        /** For GET /documents/:id/versions/:versionId/download-url. */
        versionId: z.uuid(),
      })
      .nullable(),
  })
  .meta({ id: 'SemestralReport' });
export type SemestralReport = z.infer<typeof semestralReportSchema>;

export const semestralReportListResponseSchema = z
  .object({ items: z.array(semestralReportSchema) })
  .meta({ id: 'SemestralReportListResponse' });
export type SemestralReportListResponse = z.infer<typeof semestralReportListResponseSchema>;

/** The title the generated document gets, e.g. "Semestral End Report: JPICE, 1st semester 2026-2027". */
export function reportTitle(orgAcronym: string, academicYear: string, semester: Semester): string {
  return `Semestral End Report: ${orgAcronym}, ${SEMESTER_LABELS[semester]} ${academicYear}`;
}
