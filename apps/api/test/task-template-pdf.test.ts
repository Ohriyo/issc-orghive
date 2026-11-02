import { describe, expect, it } from 'vitest';
import { analyzePdf } from '#src/lib/integrity-pages';
import { createTaskQr } from '#src/lib/task-qr';
import { filledTaskPdf } from '#src/lib/task-template-pdf';
import { missingKeywords, readFinancialTotals } from '#src/services/integrity-rules';
import { DEFAULT_TASK_KEYWORDS } from '@orghive/shared';

const qr = createTaskQr(Buffer.alloc(32, 3).toString('base64'));
const TASK = '0195f3c0-0000-7000-8000-0000000000e1';
const ORG = '0195f3c0-0000-7000-8000-0000000000a1';

describe('filledTaskPdf', () => {
  it('carries a QR code the checks read and verify, and the words they look for', async () => {
    const code = 'OH-7K3P-FR';
    const pdf = await filledTaskPdf({
      type: 'FINANCIAL_REPORT',
      organization: { name: 'The Animation Guild', acronym: 'TAG', type: 'SBO' },
      college: 'College of Computing and Information Sciences',
      project: {
        name: 'Storyboard Jam',
        targetDate: '2026-10-07',
        location: 'CCIS Lab',
        beneficiaries: 'Animation students',
      },
      label: null,
      code,
      qrContent: qr.contentOf({ code, taskId: TASK, organizationId: ORG }),
      totals: { incomeCentavos: 550_000, expensesCentavos: 300_000 },
    });
    const analysis = await analyzePdf(new Uint8Array(pdf), 1);
    expect(analysis.totalPages).toBe(1);
    const [content] = analysis.pages[0]!.qrTexts;
    expect(qr.verify(content!)).toEqual({ code, taskId: TASK, organizationId: ORG });
    // Every word the keyword check wants, with the project name and the acronym.
    expect(
      missingKeywords(analysis.textLayer, {
        keywords: DEFAULT_TASK_KEYWORDS.FINANCIAL_REPORT,
        projectName: 'Storyboard Jam',
        acronym: 'TAG',
      }),
    ).toEqual([]);
    expect(readFinancialTotals(analysis.textLayer)).toEqual({
      incomeCentavos: 550_000,
      expensesCentavos: 300_000,
    });
  }, 30_000);
});
