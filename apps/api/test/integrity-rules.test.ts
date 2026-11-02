import { describe, expect, it } from 'vitest';
import type { IntegrityCheck } from '@orghive/shared';
import {
  compareFinancialTotals,
  fileCountsForRanking,
  fileFactsOf,
  hammingDistance,
  mayDecideIntegrity,
  missingKeywords,
  rankingSubmittedAt,
  readFinancialTotals,
  taskCountsForRanking,
  taskFileIntegrity,
  taskFileStatus,
  textHasCode,
  verdictOf,
  type RankedFileFacts,
} from '#src/services/integrity-rules';
import { verifiedDoc } from './integrity-fixtures';

const pass = (kind: IntegrityCheck['kind']): IntegrityCheck => ({
  kind,
  result: 'pass',
  message: `${kind} passed`,
});
const HARD_PASSES = [pass('format'), pass('task_code'), pass('blank'), pass('exact_duplicate')];

const file = (patch: Partial<RankedFileFacts> = {}): RankedFileFacts => ({
  scanStatus: 'clean',
  legacy: false,
  checks: HARD_PASSES,
  warningsClearedAt: null,
  flaggedAt: null,
  flagReason: null,
  visibility: 'governing',
  ...patch,
});

const KEYWORDS_WARN: IntegrityCheck = {
  kind: 'keywords',
  result: 'warn',
  message: 'Missing: Accomplishment Report',
};

describe('verdictOf', () => {
  it('accepts a file whose hard checks pass, with its warnings', () => {
    expect(verdictOf([...HARD_PASSES, KEYWORDS_WARN])).toEqual({
      accepted: true,
      warnings: [KEYWORDS_WARN],
    });
  });

  it('refuses on the first failed hard check, in reading order', () => {
    const verdict = verdictOf([
      { kind: 'exact_duplicate', result: 'fail', message: 'Duplicate' },
      { kind: 'task_code', result: 'fail', message: 'No QR code' },
      pass('format'),
    ]);
    expect(verdict).toEqual({ accepted: false, reason: 'No QR code' });
  });
});

describe('taskFileIntegrity', () => {
  it('is checking while the scan or checks run, and null once refused', () => {
    expect(taskFileIntegrity(file({ scanStatus: 'checking', checks: [] }))?.state).toBe('checking');
    expect(taskFileIntegrity(file({ scanStatus: 'rejected' }))).toBeNull();
    expect(taskFileIntegrity(file({ scanStatus: 'infected' }))).toBeNull();
  });

  it('is verified without warnings, and needs attention until warnings are cleared', () => {
    expect(taskFileIntegrity(file())?.state).toBe('verified');
    const warned = file({ checks: [...HARD_PASSES, KEYWORDS_WARN] });
    expect(taskFileIntegrity(warned)).toMatchObject({
      state: 'needs_attention',
      reasons: ['Missing: Accomplishment Report'],
    });
    expect(taskFileIntegrity({ ...warned, warningsClearedAt: new Date() })?.state).toBe('verified');
  });

  it('puts a flag above everything, and never verifies a legacy file', () => {
    expect(
      taskFileIntegrity(file({ flaggedAt: new Date(), flagReason: 'Forged signature' })),
    ).toMatchObject({ state: 'flagged_invalid', reasons: ['Forged signature'] });
    expect(
      taskFileIntegrity(file({ legacy: true, checks: [], warningsClearedAt: new Date() }))?.state,
    ).toBe('legacy');
  });
});

describe('ranking', () => {
  it('counts verified public and governing files only', () => {
    expect(fileCountsForRanking(file({ visibility: 'public' }))).toBe(true);
    expect(fileCountsForRanking(file({ visibility: 'governing' }))).toBe(true);
    expect(fileCountsForRanking(file({ visibility: 'private' }))).toBe(false);
    expect(fileCountsForRanking(file({ legacy: true }))).toBe(false);
    expect(fileCountsForRanking(file({ checks: [...HARD_PASSES, KEYWORDS_WARN] }))).toBe(false);
    expect(fileCountsForRanking(file({ flaggedAt: new Date(), flagReason: 'Fake' }))).toBe(false);
  });

  it('counts a task when every filed file counts', () => {
    expect(taskCountsForRanking([])).toBe(false);
    expect(taskCountsForRanking([file(), file({ visibility: 'public' })])).toBe(true);
    // One flagged letter holds the Communication Letter task back.
    expect(taskCountsForRanking([file(), file({ flaggedAt: new Date(), flagReason: 'x' })])).toBe(
      false,
    );
    // A letter still being checked or refused is not filed: it neither counts nor holds back.
    expect(taskCountsForRanking([file(), file({ scanStatus: 'checking', checks: [] })])).toBe(true);
    expect(taskCountsForRanking([file({ scanStatus: 'rejected' })])).toBe(false);
  });
});

describe('fileFactsOf', () => {
  it('treats a clean file without an integrity row as legacy: never checked, never counted', () => {
    const checked = verifiedDoc();
    const unchecked = {
      ...checked,
      currentVersion: { ...checked.currentVersion!, integrity: null },
    };
    expect(taskFileStatus(checked)?.state).toBe('verified');
    expect(taskFileStatus(unchecked)?.state).toBe('legacy');
    expect(fileCountsForRanking(fileFactsOf(unchecked))).toBe(false);
  });
});

describe('rankingSubmittedAt', () => {
  const SUBMITTED = new Date('2026-10-10T02:00:00Z');
  const LATER = new Date('2026-11-20T02:00:00Z');

  it('keeps the task’s submission time, a legacy replacement included', () => {
    expect(rankingSubmittedAt(SUBMITTED, [{ checkedAt: LATER, replacesFlagged: false }])).toEqual(
      SUBMITTED,
    );
    expect(rankingSubmittedAt(null, [])).toBeNull();
  });

  it('counts a replacement of a flagged file from its own check', () => {
    expect(rankingSubmittedAt(SUBMITTED, [{ checkedAt: LATER, replacesFlagged: true }])).toEqual(
      LATER,
    );
  });
});

describe('mayDecideIntegrity', () => {
  const issc = { id: 'issc', type: 'ISSC' as const, parentId: null };
  const csc = { id: 'csc', type: 'CSC' as const, parentId: 'issc' };
  const otherCsc = { id: 'csc2', type: 'CSC' as const, parentId: 'issc' };
  const sbo = { id: 'sbo', type: 'SBO' as const, parentId: 'csc' };

  it('lets the governing bodies decide, never the organization itself', () => {
    expect(mayDecideIntegrity(csc, sbo)).toBe(true);
    expect(mayDecideIntegrity(issc, sbo)).toBe(true);
    expect(mayDecideIntegrity(issc, csc)).toBe(true);
    expect(mayDecideIntegrity(otherCsc, sbo)).toBe(false);
    expect(mayDecideIntegrity(sbo, sbo)).toBe(false);
    expect(mayDecideIntegrity(csc, csc)).toBe(false);
    expect(mayDecideIntegrity(csc, issc)).toBe(false);
    expect(mayDecideIntegrity(null, sbo)).toBe(false);
  });
});

describe('page hashes', () => {
  it('counts differing bits, signed values included', () => {
    expect(hammingDistance(0n, 0n)).toBe(0);
    expect(hammingDistance(0b1011n, 0b0001n)).toBe(2);
    expect(hammingDistance(-1n, 0n)).toBe(64);
  });
});

describe('text checks', () => {
  const ACR_TEXT =
    'OFFICE OF THE STUDENT BODY ORGANIZATIONS Form 7 – Accomplishment Report  The Animation Guild (TAG)  Making Moves: An Intro to 3D Animation Workshop';

  it('finds keywords, the project name and the acronym regardless of case and spacing', () => {
    expect(
      missingKeywords(ACR_TEXT, {
        keywords: ['Accomplishment Report|Activity Completion Report'],
        projectName: 'making moves:  an intro to 3D animation workshop',
        acronym: 'TAG',
      }),
    ).toEqual([]);
  });

  it('lists what is missing by its first alternative', () => {
    expect(
      missingKeywords('Minutes of the meeting', {
        keywords: ['Financial Report', 'Cash In|Pumasok'],
        projectName: 'Christmas Art Competition',
        acronym: 'TAG',
      }),
    ).toEqual(['Financial Report', 'Cash In', 'Christmas Art Competition', 'TAG']);
  });

  it('does not take an acronym inside another word', () => {
    expect(
      missingKeywords('Stage Management', { keywords: [], projectName: 'Stage', acronym: 'TAG' }),
    ).toEqual(['TAG']);
  });

  it('finds a typed code as OCR reads it', () => {
    expect(textHasCode('Ref: OH - 7K3P - ACR', 'OH-7K3P-ACR')).toBe(true);
    expect(textHasCode('Ref: OH-7K3P-FR', 'OH-7K3P-ACR')).toBe(false);
  });
});

describe('Financial Report totals', () => {
  const FORM_9 = `I. CASH IN Date Fundraising Event Amount Sept. 23, 2025 Donation Php 1,180
    Oct. 6, 2025 CSC Support Fund Php 4,000 TOTAL: Php 21,380
    II. CASH OUT Item Unit Quantity Amount Led Wall Php 1,380 Total Cash Out: Php 19,250.50`;

  it('reads total cash in and total cash out', () => {
    expect(readFinancialTotals(FORM_9)).toEqual({
      incomeCentavos: 2_138_000,
      expensesCentavos: 1_925_050,
    });
  });

  it('returns null for a total it cannot find', () => {
    expect(readFinancialTotals('CASH IN TOTAL: Php 500')).toEqual({
      incomeCentavos: 50_000,
      expensesCentavos: null,
    });
  });

  it('passes within 5% and warns beyond it, or without totals', () => {
    const entered = { incomeCentavos: 2_138_000, expensesCentavos: 1_925_050 };
    expect(compareFinancialTotals(entered, readFinancialTotals(FORM_9)).result).toBe('pass');
    expect(
      compareFinancialTotals(entered, { incomeCentavos: 2_244_900, expensesCentavos: 1_925_050 })
        .result,
    ).toBe('pass'); // exactly 5% more income
    const off = compareFinancialTotals(entered, {
      incomeCentavos: 3_000_000,
      expensesCentavos: 1_000_000,
    });
    expect(off.result).toBe('warn');
    expect(off.message).toContain('income and expenses');
    expect(
      compareFinancialTotals(entered, { incomeCentavos: null, expensesCentavos: 1 }).result,
    ).toBe('warn');
  });
});
