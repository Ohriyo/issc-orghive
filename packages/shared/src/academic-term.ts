import { z } from 'zod';

/** "2026-2027": the second year must follow the first. */
export const academicYearSchema = z
  .string()
  .regex(/^\d{4}-\d{4}$/, 'Use the form 2026-2027')
  .refine((value) => {
    const [start, end] = value.split('-').map(Number);
    return end === start! + 1;
  }, 'The second year must follow the first');

/**
 * Whether midyear counts as a term is still an open question in docs/DOMAIN_RULES.md,
 * so it is allowed here and documents may also leave the semester empty.
 */
export const SEMESTERS = ['first', 'second', 'midyear'] as const;
export const semesterSchema = z.enum(SEMESTERS);
export type Semester = z.infer<typeof semesterSchema>;
