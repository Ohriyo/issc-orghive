import { describe, expect, it, vi } from 'vitest';
import { createTaskQr } from '#src/lib/task-qr';
import type { AnalyzedPage, PdfAnalysis } from '#src/lib/integrity-pages';
import type { CheckRecord, TaskFilePlace } from '#src/repositories/integrity.repository';
import type { TaskCodeRecord } from '#src/repositories/task-code.repository';
import { createIntegrityService } from '#src/services/integrity.service';

const NOW = new Date('2026-11-20T02:00:00Z');
const TASK_ID = '0195f3c0-0000-7000-8000-0000000000c1';
const OTHER_TASK_ID = '0195f3c0-0000-7000-8000-0000000000c2';
const ORG_ID = '0195f3c0-0000-7000-8000-0000000000a1';
const OTHER_ORG_ID = '0195f3c0-0000-7000-8000-0000000000a2';
const qr = createTaskQr(Buffer.alloc(32, 5).toString('base64'));

const ACR_TEXT =
  'OFFICE OF THE STUDENT BODY ORGANIZATIONS Form 7 – Accomplishment Report The Animation Guild (TAG) Project: Tree Planting';

type TaskType = 'ACR' | 'FINANCIAL_REPORT' | 'COMMUNICATION_LETTER';

interface RecordOptions {
  type?: TaskType;
  typedCode?: string | null;
  letter?: boolean;
  flaggedBefore?: boolean;
  mimeType?: string;
  figures?: { incomeCentavos: number; expensesCentavos: number } | null;
}

function record({
  type = 'ACR',
  typedCode = null,
  letter = false,
  flaggedBefore = false,
  mimeType = 'application/pdf',
  figures = { incomeCentavos: 2_138_000, expensesCentavos: 1_925_050 },
}: RecordOptions = {}): CheckRecord {
  const task = {
    id: TASK_ID,
    type,
    project: {
      id: 'p1',
      name: 'Tree Planting',
      organization: { id: ORG_ID, slug: 'tag', acronym: 'TAG' },
      figures,
    },
  };
  return {
    id: 'v2',
    version: 2,
    storageKey: 'files/org/k2',
    mimeType,
    sizeBytes: 1000,
    sha256: 'f'.repeat(64),
    scanStatus: 'checking',
    originalFilename: 'acr-scan.pdf',
    uploadedById: 'u1',
    integrity: typedCode ? { typedCode } : null,
    document: {
      id: 'd1',
      title: 'ACR: Tree Planting',
      organization: { id: ORG_ID, slug: 'tag' },
      projectTask: letter ? null : task,
      taskFile: letter ? { id: 'file-1', label: 'Letter to the Dean', task } : null,
      versions: flaggedBefore ? [{ id: 'v1' }] : [],
    },
  };
}

const page = (patch: Partial<AnalyzedPage> = {}): AnalyzedPage => ({
  qrTexts: [],
  ink: 0.07,
  hash: 123n,
  png: Buffer.from('png'),
  ...patch,
});

const qrFor = (code: string, taskId = TASK_ID, organizationId = ORG_ID) =>
  qr.contentOf({ code, taskId, organizationId });

const CODE: TaskCodeRecord = {
  id: 'code-1',
  taskId: TASK_ID,
  code: 'OH-7K3P-ACR',
  label: null,
  taskFileId: null,
};

function setup({
  rec = record(),
  pages = [page({ qrTexts: [qrFor('OH-7K3P-ACR')] })],
  text = ACR_TEXT,
  codes = [CODE] as TaskCodeRecord[],
  analyzeFails = false,
  twin = null as TaskFilePlace | null,
  near = [] as (TaskFilePlace & { page: number; distance: number; contentText: string | null })[],
  withQr = true,
  ocrPageText = '',
} = {}) {
  const integrity = {
    findForCheck: vi.fn(() => Promise.resolve(rec)),
    exactDuplicate: vi.fn(() => Promise.resolve(twin)),
    nearDuplicates: vi.fn(() => Promise.resolve(near)),
    saveResults: vi.fn(() => Promise.resolve()),
    bindCode: vi.fn(() => Promise.resolve()),
  };
  const analysis: PdfAnalysis = { totalPages: pages.length, pages, textLayer: text };
  const tools = {
    analyze: vi.fn(() =>
      analyzeFails ? Promise.reject(new Error('encrypted')) : Promise.resolve(analysis),
    ),
    text: vi.fn(() => Promise.resolve(text)),
    ocrPage: vi.fn(() => Promise.resolve(ocrPageText)),
  };
  const documents = {
    markClean: vi.fn(() => Promise.resolve({ becameCurrent: true })),
    markRefused: vi.fn(() => Promise.resolve({ quarantinedDocument: true })),
  };
  const storage = {
    read: vi.fn(() => Promise.resolve(Buffer.from('%PDF'))),
    move: vi.fn(() => Promise.resolve()),
  };
  const deps = {
    integrity,
    codes: {
      findByCode: vi.fn((c: string) => Promise.resolve(codes.find((x) => x.code === c) ?? null)),
    },
    documents,
    storage,
    tools,
    qr: withQr ? qr : null,
    previews: { enqueuePreview: vi.fn(() => Promise.resolve()) },
    audit: { record: vi.fn(() => Promise.resolve()) },
    cache: { deleteMatching: vi.fn(() => Promise.resolve()), bump: vi.fn(() => Promise.resolve()) },
    logger: { warn: vi.fn(), info: vi.fn() },
    notifications: { notify: vi.fn(() => Promise.resolve()) },
    onAccepted: vi.fn(() => Promise.resolve()),
    now: () => NOW,
  };
  return { service: createIntegrityService(deps), ...deps };
}

/** The checks saved for the version, by kind. */
function saved(integrity: ReturnType<typeof setup>['integrity']) {
  const [, result] = integrity.saveResults.mock.calls.at(-1) as unknown as [
    string,
    {
      checks: { kind: string; result: string; message: string }[];
      replacesFlagged: boolean;
      matchedBy: string | null;
      taskCodeId: string | null;
    },
  ];
  return { ...result, byKind: Object.fromEntries(result.checks.map((c) => [c.kind, c])) };
}

describe('integrityService.checkVersion: accepted', () => {
  it('files a verified task file: current, previewed, the task moves on, the uploader told', async () => {
    const s = setup();
    await expect(s.service.checkVersion('v2')).resolves.toBe('accepted');
    const result = saved(s.integrity);
    expect(result.checks.map((c) => `${c.kind}:${c.result}`)).toEqual([
      'format:pass',
      'task_code:pass',
      'blank:pass',
      'exact_duplicate:pass',
      'near_duplicate:pass',
      'keywords:pass',
    ]);
    expect(result).toMatchObject({ taskCodeId: 'code-1', matchedBy: 'qr', replacesFlagged: false });
    expect(s.documents.markClean).toHaveBeenCalledWith(
      'v2',
      { storageKey: 'files/org/k2', sha256: 'f'.repeat(64), contentText: ACR_TEXT },
      NOW,
    );
    expect(s.previews.enqueuePreview).toHaveBeenCalledWith('v2');
    expect(s.onAccepted).toHaveBeenCalledWith('d1');
    expect(s.notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'task_file_checked', title: 'acr-scan.pdf is verified ✓' }),
    );
  });

  it('skips a version that is not waiting for its checks', async () => {
    const s = setup({ rec: { ...record(), scanStatus: 'clean' } });
    await expect(s.service.checkVersion('v2')).resolves.toBe('skipped');
    expect(s.integrity.saveResults).not.toHaveBeenCalled();
  });

  it('warns on missing keywords and a near duplicate, but files it', async () => {
    const s = setup({
      text: 'Minutes of the meeting',
      near: [
        {
          versionId: 'x',
          documentId: 'dx',
          taskType: 'ACR',
          projectName: 'Coastal Cleanup',
          acronym: 'ISO',
          page: 1,
          distance: 2,
          // Neither file has enough words to compare: the look decides.
          contentText: null,
        },
      ],
    });
    await expect(s.service.checkVersion('v2')).resolves.toBe('accepted');
    const { byKind } = saved(s.integrity);
    expect(byKind.keywords).toMatchObject({
      result: 'warn',
      message: 'Could not find: Accomplishment Report, Tree Planting, TAG.',
    });
    // Another organization's project is never named to the uploader.
    expect(byKind.near_duplicate).toMatchObject({
      result: 'warn',
      message:
        'A page looks almost the same as a page of a task file of another organization, and most of the words match.',
    });
    expect(s.notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'acr-scan.pdf needs attention' }),
    );
  });

  describe('near duplicates compare the words too (every file on a template looks alike)', () => {
    const OURS = `${ACR_TEXT} We planted two hundred mahogany seedlings along the riverbank with forty volunteers from Barangay San Pablo, and the barangay council promised to water them weekly.`;
    const lookAlike = (contentText: string) => ({
      versionId: 'x',
      documentId: 'dx',
      taskType: 'ACR' as const,
      projectName: 'Coastal Cleanup',
      acronym: 'ISO',
      page: 1,
      distance: 0,
      contentText,
    });

    it('passes a file on the same template with its own words', async () => {
      const theirs =
        'OFFICE OF THE STUDENT BODY ORGANIZATIONS Form 7 – Accomplishment Report Information Systems Organization (ISO) Project: Coastal Cleanup. Sixty students collected plastic waste on the shore of Catbalogan and sorted it for the city recycling program before noon.';
      const s = setup({ text: OURS, near: [lookAlike(theirs)] });
      await s.service.checkVersion('v2');
      expect(saved(s.integrity).byKind.near_duplicate).toMatchObject({ result: 'pass' });
    });

    it('warns on another file’s words with the names changed', async () => {
      const copied = OURS.replace(
        'The Animation Guild (TAG)',
        'Information Systems Organization (ISO)',
      );
      const s = setup({ text: OURS, near: [lookAlike(copied)] });
      await s.service.checkVersion('v2');
      const check = saved(s.integrity).byKind.near_duplicate;
      expect(check).toMatchObject({ result: 'warn', details: { matches: [{ versionId: 'x' }] } });
      // The other file's words stay out of the stored check.
      expect(JSON.stringify(check)).not.toContain('contentText');
    });
  });

  it('compares a Financial Report’s totals with the figures entered', async () => {
    const FR = `${ACR_TEXT} Financial Report I. CASH IN TOTAL: Php 21,380 II. CASH OUT Total Cash Out: Php 19,250.50`;
    const frCode = { ...CODE, code: 'OH-7K3P-FR' };
    const pages = [page({ qrTexts: [qrFor('OH-7K3P-FR')] })];
    const ok = setup({
      rec: record({ type: 'FINANCIAL_REPORT' }),
      text: FR,
      codes: [frCode],
      pages,
    });
    await ok.service.checkVersion('v2');
    expect(saved(ok.integrity).byKind.financial_totals).toMatchObject({ result: 'pass' });

    const off = setup({
      rec: record({
        type: 'FINANCIAL_REPORT',
        figures: { incomeCentavos: 5_000_000, expensesCentavos: 1_925_050 },
      }),
      text: FR,
      codes: [frCode],
      pages,
    });
    await expect(off.service.checkVersion('v2')).resolves.toBe('accepted');
    expect(saved(off.integrity).byKind.financial_totals).toMatchObject({ result: 'warn' });

    const unread = setup({
      rec: record({ type: 'FINANCIAL_REPORT' }),
      text: ACR_TEXT,
      codes: [frCode],
      pages,
    });
    await unread.service.checkVersion('v2');
    expect(saved(unread.integrity).byKind.financial_totals).toMatchObject({
      result: 'warn',
      message: 'The report’s total cash in and total cash out could not be read.',
    });
  });

  it('marks a replacement of a flagged file, and binds a letter’s code to its file', async () => {
    const letterCode = { ...CODE, code: 'OH-7K3P-CL', label: 'Letter to the Dean' };
    const s = setup({
      rec: record({ type: 'COMMUNICATION_LETTER', letter: true, flaggedBefore: true }),
      codes: [letterCode],
      pages: [page({ qrTexts: [qrFor('OH-7K3P-CL')] })],
      text: `${ACR_TEXT} Subject:`,
    });
    await expect(s.service.checkVersion('v2')).resolves.toBe('accepted');
    expect(saved(s.integrity).replacesFlagged).toBe(true);
    expect(s.integrity.bindCode).toHaveBeenCalledWith('code-1', 'file-1');
  });

  it('accepts a typed code when the QR is damaged and the code is in the text', async () => {
    const s = setup({
      rec: record({ typedCode: 'OH-7K3P-ACR' }),
      pages: [page()],
      text: `${ACR_TEXT} OH-7K3P-ACR`,
    });
    await expect(s.service.checkVersion('v2')).resolves.toBe('accepted');
    expect(saved(s.integrity)).toMatchObject({ matchedBy: 'typed', taskCodeId: 'code-1' });
  });

  it('looks for a typed code on the first page by OCR when the text layer lacks it', async () => {
    const s = setup({
      rec: record({ typedCode: 'OH-7K3P-ACR' }),
      pages: [page()],
      ocrPageText: 'OH 7K3P ACR',
    });
    await expect(s.service.checkVersion('v2')).resolves.toBe('accepted');
    expect(s.tools.ocrPage).toHaveBeenCalled();
  });
});

describe('integrityService.checkVersion: refused like a virus', () => {
  async function refusedWith(s: ReturnType<typeof setup>, reason: string) {
    await expect(s.service.checkVersion('v2')).resolves.toBe('rejected');
    expect(s.storage.move).toHaveBeenCalledWith('files/org/k2', 'quarantine/org/k2');
    expect(s.documents.markRefused).toHaveBeenCalledWith(
      'v2',
      { scanStatus: 'rejected', reason, quarantineKey: 'quarantine/org/k2' },
      NOW,
    );
    expect(s.documents.markClean).not.toHaveBeenCalled();
    expect(s.onAccepted).not.toHaveBeenCalled();
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'quarantine',
        metadata: expect.objectContaining({ reason }) as unknown,
      }),
    );
    expect(s.notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'task_file_checked', title: 'acr-scan.pdf was refused' }),
    );
  }

  it('refuses a file without a QR code or typed code', async () => {
    await refusedWith(
      setup({ pages: [page()] }),
      'No Orghive QR code was found. Upload a scan of this task’s template, or type the code printed under the QR if it is damaged.',
    );
  });

  it('refuses another task’s QR, and another organization’s', async () => {
    const otherTask = { ...CODE, id: 'code-2', code: 'OH-9ZZZ-ACR', taskId: OTHER_TASK_ID };
    await refusedWith(
      setup({
        codes: [CODE, otherTask],
        pages: [page({ qrTexts: [qrFor('OH-9ZZZ-ACR', OTHER_TASK_ID)] })],
      }),
      'This QR code belongs to another task. Download this task’s template and use it.',
    );
    const otherOrg = { ...CODE, id: 'code-3', code: 'OH-8YYY-ACR', taskId: OTHER_TASK_ID };
    await refusedWith(
      setup({
        codes: [otherOrg],
        pages: [page({ qrTexts: [qrFor('OH-8YYY-ACR', OTHER_TASK_ID, OTHER_ORG_ID)] })],
      }),
      'This QR code belongs to another organization’s task.',
    );
  });

  it('ignores a forged QR (as if there were none)', async () => {
    const forged = createTaskQr(Buffer.alloc(32, 6).toString('base64')).contentOf({
      code: 'OH-7K3P-ACR',
      taskId: TASK_ID,
      organizationId: ORG_ID,
    });
    await refusedWith(
      setup({ pages: [page({ qrTexts: [forged] })] }),
      'No Orghive QR code was found. Upload a scan of this task’s template, or type the code printed under the QR if it is damaged.',
    );
  });

  it('refuses another letter’s code on a Communication Letter', async () => {
    const bound = { ...CODE, code: 'OH-7K3P-CL', taskFileId: 'file-other' };
    await refusedWith(
      setup({
        rec: record({ type: 'COMMUNICATION_LETTER', letter: true }),
        codes: [bound],
        pages: [page({ qrTexts: [qrFor('OH-7K3P-CL')] })],
      }),
      'This QR code belongs to another Communication Letter. Each letter needs its own template.',
    );
  });

  it('refuses a typed code that is not the task’s, or not in the file', async () => {
    await refusedWith(
      setup({ rec: record({ typedCode: 'OH-0000-ACR' }), pages: [page()] }),
      'The code OH-0000-ACR is not this task’s code.',
    );
    await refusedWith(
      setup({ rec: record({ typedCode: 'OH-7K3P-ACR' }), pages: [page()] }),
      'The code OH-7K3P-ACR was not found in the file. Make sure the scan shows the code printed under the QR.',
    );
  });

  it('refuses a blank file', async () => {
    await refusedWith(
      setup({ pages: [page({ ink: 0.0001, qrTexts: [qrFor('OH-7K3P-ACR')] }), page({ ink: 0 })] }),
      'Every page is blank.',
    );
  });

  it('refuses an exact duplicate, naming only the organization’s own task', async () => {
    const own: TaskFilePlace = {
      versionId: 'x',
      documentId: 'dx',
      taskType: 'ACR',
      projectName: 'Coastal Cleanup',
      acronym: 'TAG',
    };
    await refusedWith(
      setup({ twin: own }),
      'This exact file was already submitted as the Activity Completion Report of “Coastal Cleanup”.',
    );
    await refusedWith(
      setup({ twin: { ...own, acronym: 'ISO' } }),
      'This exact file was already submitted as a task file of another organization.',
    );
  });

  it('refuses a file that is not a readable PDF', async () => {
    await refusedWith(
      setup({ rec: record({ mimeType: 'image/jpeg' }) }),
      'Upload the task file as a PDF scan of its template.',
    );
    await refusedWith(
      setup({ analyzeFails: true }),
      'The PDF could not be opened: it is damaged or password-protected.',
    );
  });

  it('refuses every file while QR codes cannot be verified (no TASK_QR_SECRET)', async () => {
    await refusedWith(
      setup({ withQr: false }),
      'Task codes cannot be checked right now. Try again later.',
    );
  });
});
