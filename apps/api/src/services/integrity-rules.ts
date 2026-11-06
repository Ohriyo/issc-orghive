import {
  countsForRanking,
  FINANCIAL_TOTALS_TOLERANCE,
  isHardCheck,
  type DocumentVisibility,
  type IntegrityCheck,
  type IntegrityCheckKind,
  type IntegrityResult,
  type TaskFileIntegrity,
} from '@orghive/shared';
import type { IntegrityDocumentRecord } from '#src/repositories/integrity-select';
import { isGoverningBodyOf, type OrgPlace } from './account-rules';

/*
 * The integrity rules of project task files (docs/PROJECT_WORKFLOW_SPEC.md, section 6), in
 * one place. Pure, so each is tested on its own. They never decide who may view a file (its
 * visibility alone does): only whether a task is complete and whether it counts for ranking.
 */

/** Order the organization reads them in: what refused the file first, then the warnings. */
const CHECK_ORDER: IntegrityCheckKind[] = [
  'format',
  'task_code',
  'blank',
  'exact_duplicate',
  'near_duplicate',
  'keywords',
  'financial_totals',
];

export function sortChecks<T extends { kind: IntegrityCheckKind }>(checks: T[]): T[] {
  return [...checks].sort((a, b) => CHECK_ORDER.indexOf(a.kind) - CHECK_ORDER.indexOf(b.kind));
}

export type IntegrityVerdict =
  { accepted: true; warnings: IntegrityCheck[] } | { accepted: false; reason: string };

/**
 * What the checks decide about an upload: a failed hard check (format, task code, blank, exact
 * duplicate) refuses it, with the first failure's message; otherwise it is complete, with any
 * warnings. A hard check can only pass or fail; anything else can only pass or warn.
 */
export function verdictOf(checks: IntegrityCheck[]): IntegrityVerdict {
  const sorted = sortChecks(checks);
  const failed = sorted.find((c) => isHardCheck(c.kind) && c.result === 'fail');
  if (failed) return { accepted: false, reason: failed.message };
  return { accepted: true, warnings: sorted.filter((c) => c.result === 'warn') };
}

/** What is stored about one version of a task's file. */
export interface TaskFileFacts {
  scanStatus: 'pending' | 'checking' | 'clean' | 'infected' | 'invalid' | 'rejected';
  /** Filed before the checks existed. */
  legacy: boolean;
  checks: IntegrityCheck[];
  warningsClearedAt: Date | null;
  flaggedAt: Date | null;
  flagReason: string | null;
}

/**
 * Where a task's current file stands (TASK_FILE_INTEGRITY_STATES). A flag outranks
 * everything; a legacy file is never verified; cleared warnings make a file verified.
 * Null while the file is not filed yet (still scanning, or refused).
 */
export function taskFileIntegrity(file: TaskFileFacts): TaskFileIntegrity | null {
  const checks = sortChecks(file.checks).map(({ kind, result, message }) => ({
    kind,
    result,
    message,
  }));
  if (file.scanStatus === 'pending' || file.scanStatus === 'checking') {
    return { state: 'checking', reasons: [], checks };
  }
  if (file.scanStatus !== 'clean') return null;
  if (file.flaggedAt) {
    return { state: 'flagged_invalid', reasons: [file.flagReason ?? 'Flagged invalid'], checks };
  }
  if (file.legacy) {
    return {
      state: 'legacy',
      reasons: ['Filed before Orghive checked task files. Re-upload it on its template.'],
      checks,
    };
  }
  const warnings = checks.filter((c) => c.result === 'warn').map((c) => c.message);
  if (warnings.length > 0 && !file.warningsClearedAt) {
    return { state: 'needs_attention', reasons: warnings, checks };
  }
  return { state: 'verified', reasons: [], checks };
}

/** A filed task file as ranking sees it. */
export interface RankedFileFacts extends TaskFileFacts {
  visibility: DocumentVisibility;
}

/**
 * Whether one file counts for ranking: verified, and shared with the governing bodies or the
 * public. A private file completes its task but never counts (spec section 6).
 */
export function fileCountsForRanking(file: RankedFileFacts): boolean {
  return taskFileIntegrity(file)?.state === 'verified' && countsForRanking(file.visibility);
}

/**
 * Whether a task counts for ranking: it has at least one filed file and every filed file
 * counts (a Communication Letter holds several; a flagged or private letter holds the task
 * back until it is replaced or shared).
 */
export function taskCountsForRanking(files: RankedFileFacts[]): boolean {
  const filed = files.filter((f) => f.scanStatus === 'clean');
  return filed.length > 0 && filed.every(fileCountsForRanking);
}

/** One file of a task, for its ranking submission time. */
export interface ResubmissionFacts {
  /** When its current version passed the checks. */
  checkedAt: Date | null;
  /** An earlier version of this file was flagged invalid. */
  replacesFlagged: boolean;
}

/**
 * When a task was submitted, for lateness on the leaderboard (spec 5C and section 6):
 * - normally its `submittedAt`, the moment its first file was complete;
 * - a file that replaces one flagged invalid counts from its own check, so a fake fixed late
 *   is late;
 * - a file that replaces a legacy one keeps the task's original time: the rule changed, not
 *   the organization.
 */
export function rankingSubmittedAt(
  submittedAt: Date | null,
  files: ResubmissionFacts[],
): Date | null {
  if (!submittedAt) return null;
  let at = submittedAt.getTime();
  for (const file of files) {
    if (file.replacesFlagged && file.checkedAt) at = Math.max(at, file.checkedAt.getTime());
  }
  return new Date(at);
}

/**
 * Who may clear a file's warnings or flag it invalid: its organization's governing bodies
 * (an SBO's college CSC or the ISSC; a CSC's ISSC), never the organization itself.
 */
export function mayDecideIntegrity(actor: OrgPlace | null, owner: OrgPlace): boolean {
  return !!actor && actor.id !== owner.id && isGoverningBodyOf(actor, owner);
}

/** Bits that differ between two 64-bit page hashes. */
export function hammingDistance(a: bigint, b: bigint): number {
  let x = BigInt.asUintN(64, a ^ b);
  let bits = 0;
  while (x > 0n) {
    x &= x - 1n;
    bits += 1;
  }
  return bits;
}

/** Lower case, accents dropped, every run of spaces one space: OCR text compares this way. */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * How much of two files' wording matches for their look-alike pages to count as a near
 * duplicate (spec section 6B). Every file on the same template looks alike, so the page hash
 * alone flags them all; a copied file keeps the other's words, a filled-in one has its own.
 */
export const NEAR_DUPLICATE_TEXT_MIN = 0.7;
/** Below this many words, a file's text says too little to compare. */
const MIN_COMPARED_WORDS = 20;

/** The file's three-word phrases, without its own task code (every file has a different one). */
function phrasesOf(text: string): Set<string> | null {
  const words = normalizeText(text)
    .replace(/\boh-[a-z0-9]{4,}-[a-z]{2,4}\b/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (words.length < MIN_COMPARED_WORDS) return null;
  const phrases = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) phrases.add(words.slice(i, i + 3).join(' '));
  return phrases;
}

/**
 * The share of three-word phrases two files have in common (Jaccard), 0 to 1, or null when
 * either text is too short to tell: a template's fixed wording is a few phrases among many.
 */
export function textSimilarity(a: string | null, b: string | null): number | null {
  const left = a ? phrasesOf(a) : null;
  const right = b ? phrasesOf(b) : null;
  if (!left || !right) return null;
  let shared = 0;
  for (const phrase of left) if (right.has(phrase)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/**
 * Whether a file whose pages look like another's is a near duplicate of it: only when their
 * words mostly match too. Without readable text on either side, the look decides alone.
 */
export function isNearDuplicate(ownText: string | null, otherText: string | null): boolean {
  const similarity = textSimilarity(ownText, otherText);
  return similarity === null || similarity >= NEAR_DUPLICATE_TEXT_MIN;
}

/**
 * The expected phrases (`|` between alternatives) the text does not contain, as configured,
 * plus the project name and the organization's acronym when they are missing.
 */
export function missingKeywords(
  text: string,
  expected: { keywords: string[]; projectName: string; acronym: string },
): string[] {
  const haystack = normalizeText(text);
  const has = (phrase: string) => haystack.includes(normalizeText(phrase));
  const missing = expected.keywords.filter((entry) => !entry.split('|').some(has));
  if (!has(expected.projectName)) missing.push(expected.projectName);
  if (!new RegExp(`\\b${escapeRegExp(normalizeText(expected.acronym))}\\b`).test(haystack)) {
    missing.push(expected.acronym);
  }
  return missing.map((entry) => entry.split('|')[0]!);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether the typed short code appears in the text (spaces and dashes as OCR reads them). */
export function textHasCode(text: string, code: string): boolean {
  const compact = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return compact(text).includes(compact(code));
}

const AMOUNT = String.raw`(?:php|p|₱)?\s*([0-9]{1,3}(?:[ ,][0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)`;

function centavosOf(amount: string): number {
  const [whole, cents = ''] = amount.replace(/[ ,]/g, '').split('.');
  return Number(whole) * 100 + Number(cents.padEnd(2, '0'));
}

/**
 * The totals of a Financial Report (Form 9), read from its text: the Cash In section's
 * "TOTAL:" and "Total Cash Out:". Null for a total not found.
 */
export function readFinancialTotals(text: string): {
  incomeCentavos: number | null;
  expensesCentavos: number | null;
} {
  const flat = normalizeText(text);
  const cashOutAt = flat.search(/cash out/);
  const expenses = new RegExp(`total cash out\\s*:?\\s*${AMOUNT}`).exec(flat);
  const incomeArea = cashOutAt >= 0 ? flat.slice(0, cashOutAt) : flat;
  const income =
    new RegExp(`total cash in\\s*:?\\s*${AMOUNT}`).exec(incomeArea) ??
    new RegExp(`total\\s*:\\s*${AMOUNT}`).exec(incomeArea);
  return {
    incomeCentavos: income ? centavosOf(income[1]!) : null,
    expensesCentavos: expenses ? centavosOf(expenses[1]!) : null,
  };
}

/**
 * The Financial Report check: each total read from the file is within 5% of the figure the
 * organization entered. A total not found, or one off by more, warns (spec section 6).
 */
export function compareFinancialTotals(
  entered: { incomeCentavos: number; expensesCentavos: number },
  read: { incomeCentavos: number | null; expensesCentavos: number | null },
  tolerance = FINANCIAL_TOTALS_TOLERANCE,
): { result: IntegrityResult; message: string } {
  if (read.incomeCentavos === null || read.expensesCentavos === null) {
    return {
      result: 'warn',
      message: 'The report’s total cash in and total cash out could not be read.',
    };
  }
  const off = (enteredValue: number, readValue: number) =>
    Math.abs(readValue - enteredValue) > tolerance * Math.max(Math.abs(enteredValue), 1);
  const wrong = [
    off(entered.incomeCentavos, read.incomeCentavos) && 'income',
    off(entered.expensesCentavos, read.expensesCentavos) && 'expenses',
  ].filter(Boolean);
  if (wrong.length > 0) {
    return {
      result: 'warn',
      message: `The report’s total ${wrong.join(' and ')} differ from the figures entered by over ${Math.round(tolerance * 100)}%.`,
    };
  }
  return { result: 'pass', message: 'The report’s totals match the figures entered.' };
}

/** The rules' view of a task's stored file: its current version, or not filed without one. */
export function fileFactsOf(doc: IntegrityDocumentRecord): RankedFileFacts & ResubmissionFacts {
  const version = doc.currentVersion;
  const integrity = version?.integrity;
  // Filed: not deleted, and its current version passed (the document is available or archived).
  const filed = !doc.deletedAt && (doc.status === 'available' || doc.status === 'archived');
  return {
    scanStatus: filed && version ? version.scanStatus : 'pending',
    // No integrity row: never checked (every check, and the backfill, writes one), so it
    // does not count until it is, rather than counting by default.
    legacy: integrity ? integrity.legacy : true,
    checks: version?.checks ?? [],
    warningsClearedAt: integrity?.warningsClearedAt ?? null,
    flaggedAt: integrity?.flaggedAt ?? null,
    flagReason: integrity?.flagReason ?? null,
    visibility: doc.visibility,
    checkedAt: integrity?.checkedAt ?? null,
    replacesFlagged: integrity?.replacesFlagged ?? false,
  };
}

/** What the organization is told about an upload the worker refused. */
const REFUSED_BY_SCAN: Record<'infected' | 'invalid', string> = {
  infected: 'The virus scan found something harmful in it.',
  invalid: 'Its content does not match its file type.',
};

/**
 * What the organization and its governing bodies see of a task's file: its newest upload
 * while that is still being checked or was refused (the task keeps its earlier file), else
 * its current file (taskFileIntegrity). Null for a deleted file.
 */
export function taskFileStatus(doc: IntegrityDocumentRecord): TaskFileIntegrity | null {
  if (doc.deletedAt) return null;
  const latest = doc.versions[0];
  if (latest && latest.id !== doc.currentVersionId && latest.scanStatus === 'clean') {
    // A newer clean version always becomes current; until it does, it is being checked.
    return { state: 'checking', reasons: [], checks: [] };
  }
  switch (latest?.scanStatus) {
    case 'pending':
    case 'checking':
      return { state: 'checking', reasons: [], checks: [] };
    case 'rejected':
      return {
        state: 'refused',
        reasons: [latest.failureReason ?? 'It did not pass the checks.'],
        checks: [],
      };
    case 'infected':
    case 'invalid':
      return { state: 'refused', reasons: [REFUSED_BY_SCAN[latest.scanStatus]], checks: [] };
    default:
      return taskFileIntegrity(fileFactsOf(doc));
  }
}
