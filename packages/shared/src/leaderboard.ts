import { z } from 'zod';
import { academicYearSchema, semesterSchema } from './academic-term';
import { actingAsSchema } from './acting-as';

/*
 * The leaderboard (docs/PROJECT_WORKFLOW_SPEC.md, section 5 "Leaderboard rules"). Money is
 * always integer centavos, never a float: ₱12,345.50 is 1234550.
 */

/** One Financial Report figure may not exceed ₱10,000,000.00 (fits a 32-bit integer). */
export const MAX_FIGURE_CENTAVOS = 1_000_000_000;

/** A Financial Report figure in centavos: a whole number from 0 to MAX_FIGURE_CENTAVOS. */
export const centavosSchema = z
  .number({ error: 'Enter an amount' })
  .int('Amounts are whole centavos')
  .min(0, 'Amounts cannot be negative')
  .max(MAX_FIGURE_CENTAVOS, 'Amounts cannot exceed ₱10,000,000.00');

const PESOS_PATTERN = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;

/**
 * Pesos as an officer types them ("12,345.50", "₱ 800", "1000.5") in centavos, or null when
 * the text is not an amount. Commas must group thousands; at most two decimals.
 */
export function parsePesos(text: string): number | null {
  const cleaned = text.trim().replace(/^₱\s*/, '');
  if (!PESOS_PATTERN.test(cleaned)) return null;
  const [whole, fraction = ''] = cleaned.replaceAll(',', '').split('.');
  const centavos = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(centavos) ? centavos : null;
}

/** Centavos as `₱12,345.00`; a negative amount as `−₱1,234.00` (a true minus sign). */
export function formatPesos(centavos: number): string {
  const abs = Math.abs(Math.trunc(centavos));
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (abs % 100).toString().padStart(2, '0');
  return `${centavos < 0 ? '−' : ''}₱${whole}.${fraction}`;
}

/** Centavos as the plain text a form field starts with (`12345.50`), no symbol or commas. */
export function pesosInputValue(centavos: number): string {
  return `${Math.floor(centavos / 100)}.${(centavos % 100).toString().padStart(2, '0')}`;
}

/** A form field holding pesos, parsed to centavos. */
export function pesosTextSchema(what: string) {
  return z
    .string()
    .trim()
    .min(1, `Enter the ${what}`)
    .transform((text, ctx) => {
      const centavos = parsePesos(text);
      if (centavos === null) {
        ctx.addIssue({ code: 'custom', message: `Enter the ${what} in pesos, e.g. 12,345.50` });
        return z.NEVER;
      }
      return centavos;
    })
    .pipe(centavosSchema);
}

/** A Financial Report's totals (spec 5D). Net profit is income − expenses. */
export const financialFiguresSchema = z.strictObject({
  incomeCentavos: centavosSchema,
  expensesCentavos: centavosSchema,
});
export type FinancialFiguresInput = z.infer<typeof financialFiguresSchema>;

/** The two fields of the Financial Report form, as typed. */
export const financialFiguresFormSchema = z.object({
  income: pesosTextSchema('total income'),
  expenses: pesosTextSchema('total expenses'),
});
export type FinancialFiguresForm = z.input<typeof financialFiguresFormSchema>;

/** PATCH /projects/:projectId/financial-figures: a correction, with who is acting. */
export const correctFinancialFiguresRequestSchema = financialFiguresSchema.extend({
  actingAs: actingAsSchema,
});
export type CorrectFinancialFiguresRequest = z.infer<typeof correctFinancialFiguresRequestSchema>;

export const FLAG_REMARK_MAX_LENGTH = 500;

/** PUT /admin/projects/:projectId/financial-figures/flag: the ISSC's reason. */
export const flagFinancialFiguresRequestSchema = z.strictObject({
  remark: z
    .string()
    .trim()
    .min(3, 'Say what needs checking')
    .max(FLAG_REMARK_MAX_LENGTH, `Keep the remark under ${FLAG_REMARK_MAX_LENGTH} characters`),
});
export type FlagFinancialFiguresRequest = z.infer<typeof flagFinancialFiguresRequestSchema>;

/** A project's figures as the organization and its governing bodies see them. */
export const projectFinancialFiguresSchema = z.object({
  incomeCentavos: z.number().int(),
  expensesCentavos: z.number().int(),
  netCentavos: z.number().int(),
  /** Set while the ISSC has the figures under review: they are left out of the total. */
  underReview: z.object({ remark: z.string(), flaggedAt: z.iso.datetime() }).nullable(),
  /** The organization can correct them until this instant (spec 5D). */
  correctableUntil: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ProjectFinancialFigures = z.infer<typeof projectFinancialFiguresSchema>;

/** GET /admin/financial-figures: the semester's submitted figures, for the ISSC to check. */
export const financialFiguresQuerySchema = z.object({
  academicYear: academicYearSchema,
  semester: semesterSchema,
});
export type FinancialFiguresQuery = z.infer<typeof financialFiguresQuerySchema>;

export const financialFiguresListItemSchema = projectFinancialFiguresSchema
  .omit({ correctableUntil: true })
  .extend({
    projectId: z.uuid(),
    projectName: z.string(),
    targetDate: z.iso.date(),
    organization: z.object({ slug: z.string(), acronym: z.string(), name: z.string() }),
  });
export type FinancialFiguresListItem = z.infer<typeof financialFiguresListItemSchema>;

export const financialFiguresListResponseSchema = z
  .object({ items: z.array(financialFiguresListItemSchema) })
  .meta({ id: 'FinancialFiguresListResponse' });
export type FinancialFiguresListResponse = z.infer<typeof financialFiguresListResponseSchema>;

/** Points for a late implemented project unless the super admin changes it (spec 5C). */
export const DEFAULT_LATE_POINTS = 0.5;

/** 0 to 1, in hundredths. */
export const latePointsSchema = z
  .number({ error: 'Enter a number from 0 to 1' })
  .min(0, 'Use a number from 0 to 1')
  .max(1, 'Use a number from 0 to 1')
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9, 'Use at most two decimals');

/** GET /system/settings. */
export const systemSettingsSchema = z
  .object({
    leaderboardLatePoints: latePointsSchema,
    updatedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'SystemSettings' });
export type SystemSettings = z.infer<typeof systemSettingsSchema>;

/** PATCH /system/settings: only what changes. */
export const updateSystemSettingsRequestSchema = z
  .strictObject({ leaderboardLatePoints: latePointsSchema })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Change at least one setting');
export type UpdateSystemSettingsRequest = z.infer<typeof updateSystemSettingsRequestSchema>;

/** The boards: SBOs and CSCs are ranked separately; the ISSC never (spec 5A). */
export const LEADERBOARD_TYPES = ['SBO', 'CSC'] as const;
export const leaderboardTypeSchema = z.enum(LEADERBOARD_TYPES);
export type LeaderboardType = z.infer<typeof leaderboardTypeSchema>;

/** `4.5`, `1`, `0.25`: points without trailing zeros. */
export function formatPoints(points: number): string {
  return String(Math.round(points * 100) / 100);
}

/** The breakdown shown wherever points are (spec 5C): "4.5 pts · 5 projects (1 late)". */
export function pointsBreakdown(points: number, implemented: number, late: number): string {
  const pts = `${formatPoints(points)} ${points === 1 ? 'pt' : 'pts'}`;
  const projects = `${implemented} ${implemented === 1 ? 'project' : 'projects'}`;
  return late > 0 ? `${pts} · ${projects} (${late} late)` : `${pts} · ${projects}`;
}

/** "(1 report under review)" next to a total with flagged figures; empty when none. */
export function underReviewNote(count: number): string {
  if (count <= 0) return '';
  return `(${count} ${count === 1 ? 'report' : 'reports'} under review)`;
}
