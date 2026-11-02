import { z } from 'zod';
import { actingAsSchema } from './acting-as';
import type { DocumentVisibility } from './document';
import type { ProjectTaskType } from './project';

/**
 * Integrity checks on a project task's file (docs/PROJECT_WORKFLOW_SPEC.md, section 6).
 * They never decide who may view a file (that is its visibility alone): they decide whether
 * the task is complete for the workflow and whether it counts on the leaderboard.
 */

/** The tasks whose files are checked: every task except the optional other pre-event files. */
export const CHECKED_TASK_TYPES = [
  'PROPOSAL',
  'NOM',
  'MOM',
  'COMMUNICATION_LETTER',
  'ATTENDANCE_SHEET',
  'ACR',
  'FINANCIAL_REPORT',
] as const satisfies readonly ProjectTaskType[];
export type CheckedTaskType = (typeof CHECKED_TASK_TYPES)[number];

export function isCheckedTask(type: ProjectTaskType): type is CheckedTaskType {
  return (CHECKED_TASK_TYPES as readonly string[]).includes(type);
}

export const INTEGRITY_CHECK_KINDS = [
  'format',
  'task_code',
  'blank',
  'exact_duplicate',
  'near_duplicate',
  'keywords',
  'financial_totals',
] as const;
export const integrityCheckKindSchema = z.enum(INTEGRITY_CHECK_KINDS);
export type IntegrityCheckKind = z.infer<typeof integrityCheckKindSchema>;

/** A failed hard check refuses the upload; every other check can only warn. */
export const HARD_CHECKS = [
  'format',
  'task_code',
  'blank',
  'exact_duplicate',
] as const satisfies readonly IntegrityCheckKind[];

export function isHardCheck(kind: IntegrityCheckKind): boolean {
  return (HARD_CHECKS as readonly string[]).includes(kind);
}

export const INTEGRITY_RESULTS = ['pass', 'warn', 'fail'] as const;
export const integrityResultSchema = z.enum(INTEGRITY_RESULTS);
export type IntegrityResult = z.infer<typeof integrityResultSchema>;

/** The short code's suffix per task, e.g. OH-7K3P-ACR. */
export const TASK_CODE_SUFFIXES: Record<CheckedTaskType, string> = {
  PROPOSAL: 'PROP',
  NOM: 'NOM',
  MOM: 'MOM',
  COMMUNICATION_LETTER: 'CL',
  ATTENDANCE_SHEET: 'ATT',
  ACR: 'ACR',
  FINANCIAL_REPORT: 'FR',
};

/**
 * Crockford base32 without the letters people misread (I, L, O, U): what the random part of
 * a short code is drawn from, so a damaged QR's code can be typed back reliably.
 */
export const TASK_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const TASK_CODE_RANDOM_LENGTH = 4;

const suffixes = Object.values(TASK_CODE_SUFFIXES).join('|');
const TASK_CODE_PATTERN = new RegExp(
  `^OH-[${TASK_CODE_ALPHABET}]{${TASK_CODE_RANDOM_LENGTH}}-(?:${suffixes})$`,
);

/**
 * How people type a code: any case, spaces or no dashes. Look-alike letters are read as the
 * digits they stand for (O → 0, I and L → 1), as Crockford base32 does.
 */
export function normalizeTaskCode(input: string): string {
  const compact = input.toUpperCase().replace(/[\s_–—-]+/g, '');
  if (!compact.startsWith('OH')) return compact;
  const random = compact
    .slice(2, 2 + TASK_CODE_RANDOM_LENGTH)
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return `OH-${random}-${compact.slice(2 + TASK_CODE_RANDOM_LENGTH)}`;
}

export function isTaskCode(code: string): boolean {
  return TASK_CODE_PATTERN.test(code);
}

/** The short code typed at upload when the QR is damaged. */
export const taskCodeSchema = z
  .string()
  .trim()
  .transform(normalizeTaskCode)
  .refine(isTaskCode, 'Type the code under the QR, e.g. OH-7K3P-ACR');

/**
 * Words each task's file is expected to contain (OCR, English and Filipino): one entry per
 * phrase, `|` between alternatives. Missing ones only warn. The super admin can change them
 * in /system; these are the defaults, from the official forms (S.Y. 2026-2027).
 */
export const DEFAULT_TASK_KEYWORDS: Record<CheckedTaskType, string[]> = {
  PROPOSAL: ['Project Proposal', 'Project Title|Pamagat'],
  NOM: ['Notice of Meeting|Paunawa'],
  MOM: ['Minutes of the Meeting|Minutes of Meeting|Katitikan'],
  COMMUNICATION_LETTER: ['Subject|Paksa'],
  ATTENDANCE_SHEET: ['Attendance|Pagdalo'],
  ACR: ['Accomplishment Report|Activity Completion Report'],
  FINANCIAL_REPORT: ['Financial Report', 'Cash In', 'Cash Out'],
};

const keywordSchema = z.string().trim().min(2).max(80);
export const taskKeywordsSchema = z.strictObject(
  Object.fromEntries(
    CHECKED_TASK_TYPES.map((type) => [type, z.array(keywordSchema).max(10)]),
  ) as Record<CheckedTaskType, z.ZodArray<typeof keywordSchema>>,
);
export type TaskKeywords = z.infer<typeof taskKeywordsSchema>;

/**
 * Near-duplicate pages: two page hashes this many bits apart or fewer (of 64) look the same.
 * A setting, so false alarms from shared templates can be tuned.
 */
export const DEFAULT_NEAR_DUPLICATE_BITS = 6;
export const nearDuplicateBitsSchema = z
  .number({ error: 'Enter a whole number from 0 to 16' })
  .int('Enter a whole number from 0 to 16')
  .min(0, 'Enter a whole number from 0 to 16')
  .max(16, 'Enter a whole number from 0 to 16');
/** The Financial Report's totals may differ this much (each, from the figures entered). */
export const FINANCIAL_TOTALS_TOLERANCE = 0.05;

/** Visibilities whose files count on the leaderboard: private files complete tasks only. */
export const RANKED_VISIBILITIES = ['public', 'governing'] as const satisfies DocumentVisibility[];
export function countsForRanking(visibility: DocumentVisibility): boolean {
  return (RANKED_VISIBILITIES as readonly string[]).includes(visibility);
}

/**
 * Where a task's newest upload stands, as its organization and governing bodies see it:
 * - `checking`: its scan or checks are running;
 * - `refused`: it failed the virus scan or a hard check; the task keeps its earlier file;
 * - `verified`: every check passed (or its warnings were cleared);
 * - `needs_attention`: it passed the hard checks with warnings nobody cleared yet;
 * - `flagged_invalid`: a governing body flagged it; it does not count until re-uploaded;
 * - `legacy`: filed before the checks existed; it does not count until re-uploaded on a template.
 */
export const TASK_FILE_INTEGRITY_STATES = [
  'checking',
  'refused',
  'verified',
  'needs_attention',
  'flagged_invalid',
  'legacy',
] as const;
export const taskFileIntegrityStateSchema = z.enum(TASK_FILE_INTEGRITY_STATES);
export type TaskFileIntegrityState = z.infer<typeof taskFileIntegrityStateSchema>;

export const integrityCheckSchema = z.object({
  kind: integrityCheckKindSchema,
  result: integrityResultSchema,
  /** One sentence for the organization, e.g. "No QR code or short code was found." */
  message: z.string(),
});
export type IntegrityCheck = z.infer<typeof integrityCheckSchema>;

export const taskFileIntegritySchema = z.object({
  state: taskFileIntegrityStateSchema,
  /** Why it was refused, its warnings, or the flag's reason, in the order to show them. */
  reasons: z.array(z.string()),
  checks: z.array(integrityCheckSchema),
});
export type TaskFileIntegrity = z.infer<typeof taskFileIntegritySchema>;

export const FLAG_REASON_MAX_LENGTH = 500;

/** POST …/integrity/flag: a governing body flags a submitted file as invalid. */
export const flagTaskFileRequestSchema = z.strictObject({
  reason: z
    .string()
    .trim()
    .min(5, 'Say why the file is invalid')
    .max(FLAG_REASON_MAX_LENGTH, `Keep it under ${FLAG_REASON_MAX_LENGTH} characters`),
  actingAs: actingAsSchema,
});
export type FlagTaskFileRequest = z.infer<typeof flagTaskFileRequestSchema>;

/** POST …/integrity/clear-warnings: a governing body accepts a file's warnings. */
export const clearTaskFileWarningsRequestSchema = z.strictObject({
  note: z.string().trim().max(FLAG_REASON_MAX_LENGTH).optional(),
  actingAs: actingAsSchema,
});
export type ClearTaskFileWarningsRequest = z.infer<typeof clearTaskFileWarningsRequestSchema>;

/** POST /task-files/:documentId/integrity/{clear-warnings,flag}: the file as it now stands. */
export const taskFileDecisionResponseSchema = z
  .object({ documentId: z.uuid(), integrity: taskFileIntegritySchema })
  .meta({ id: 'TaskFileDecisionResponse' });
export type TaskFileDecisionResponse = z.infer<typeof taskFileDecisionResponseSchema>;

/** POST …/tasks/:type/template: a multi-file task's new file needs its label first. */
export const taskTemplateRequestSchema = z.strictObject({
  label: z.string().trim().min(2).max(80).optional(),
  format: z.enum(['docx', 'pdf']).default('docx'),
});
export type TaskTemplateRequest = z.input<typeof taskTemplateRequestSchema>;
