import {
  DEFAULT_NEAR_DUPLICATE_BITS,
  DEFAULT_TASK_KEYWORDS,
  isCheckedTask,
  isMultiFileTask,
  MAX_UPLOAD_BYTES,
  PROJECT_TASK_LABELS,
  type IntegrityCheck,
  type TaskKeywords,
} from '@orghive/shared';
import { type Cache, invalidateDocuments } from '#src/lib/cache';
import { BLANK_INK_RATIO, type PdfAnalysis } from '#src/lib/integrity-pages';
import type { PreviewQueue } from '#src/lib/queue';
import type { Storage } from '#src/lib/storage';
import type { TaskQr } from '#src/lib/task-qr';
import type { Logger } from '#src/logger';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { DocumentRepository } from '#src/repositories/document.repository';
import type {
  CheckDetails,
  CheckRecord,
  CodeMatch,
  IntegrityRepository,
  TaskFilePlace,
} from '#src/repositories/integrity.repository';
import type { TaskCodeRepository } from '#src/repositories/task-code.repository';
import {
  compareFinancialTotals,
  missingKeywords,
  readFinancialTotals,
  textHasCode,
  verdictOf,
} from './integrity-rules';
import type { NotificationService } from './notification.service';

/** What the checks read from a PDF (lib/integrity-pages.ts in production, fakes in tests). */
export interface IntegrityTools {
  analyze(pdf: Uint8Array, maxPages: number): Promise<PdfAnalysis>;
  /** The file's text: its text layer, or OCR of its first pages. */
  text(analysis: PdfAnalysis): Promise<string>;
  /** OCR of one page, when a typed code must be found on it. */
  ocrPage(png: Buffer): Promise<string>;
}

export interface IntegritySettings {
  keywords(): Promise<TaskKeywords>;
  nearDuplicateBits(): Promise<number>;
}

export const DEFAULT_INTEGRITY_SETTINGS: IntegritySettings = {
  keywords: () => Promise.resolve(DEFAULT_TASK_KEYWORDS),
  nearDuplicateBits: () => Promise.resolve(DEFAULT_NEAR_DUPLICATE_BITS),
};

export interface IntegrityServiceDeps {
  integrity: Pick<
    IntegrityRepository,
    'findForCheck' | 'exactDuplicate' | 'nearDuplicates' | 'saveResults' | 'bindCode'
  >;
  codes: Pick<TaskCodeRepository, 'findByCode'>;
  documents: Pick<DocumentRepository, 'markClean' | 'markRefused'>;
  storage: Pick<Storage, 'read' | 'move'>;
  tools: IntegrityTools;
  /** Null when TASK_QR_SECRET is not set: no code can be verified, so files are refused. */
  qr: TaskQr | null;
  previews: PreviewQueue;
  audit: Pick<AuditLogRepository, 'record'>;
  cache: Pick<Cache, 'deleteMatching' | 'bump'>;
  logger: Pick<Logger, 'warn' | 'info'>;
  notifications: Pick<NotificationService, 'notify'>;
  /** A task's file passed: its project may move on (project-sync documentScanned). */
  onAccepted: (documentId: string) => Promise<void>;
  settings?: IntegritySettings;
  now?: () => Date;
}

export type IntegrityOutcome = 'accepted' | 'rejected' | 'skipped';

type Check = IntegrityCheck & { details?: CheckDetails };

/**
 * Pages read for the code, blank and duplicate checks. Task files are a few pages; a QR on
 * every page means the first ones are enough.
 */
export const MAX_CHECKED_PAGES = 30;

const pass = (kind: Check['kind'], message: string, details?: Check['details']): Check => ({
  kind,
  result: 'pass',
  message,
  details,
});
const fail = (kind: Check['kind'], message: string, details?: Check['details']): Check => ({
  kind,
  result: 'fail',
  message,
  details,
});
const warn = (kind: Check['kind'], message: string, details?: Check['details']): Check => ({
  kind,
  result: 'warn',
  message,
  details,
});

/** files/<org>/<uuid> -> quarantine/<org>/<uuid>, like a file the virus scan refused. */
function quarantineKeyOf(storageKey: string): string {
  return `quarantine/${storageKey.replace(/^files\//, '')}`;
}

/**
 * "the ACR of “Tree Planting”" for the organization's own files; another organization's are
 * never named to the uploader (their projects are theirs), only in the stored details.
 */
function placeText(place: TaskFilePlace, ownAcronym: string): string {
  if (place.acronym !== ownAcronym) return 'a task file of another organization';
  return `the ${PROJECT_TASK_LABELS[place.taskType]} of “${place.projectName}”`;
}

const NO_CODE =
  'No Orghive QR code was found. Upload a scan of this task’s template, or type the code printed under the QR if it is damaged.';

/**
 * The integrity checks of a project task's file (docs/PROJECT_WORKFLOW_SPEC.md, section 6),
 * run by the worker after the virus scan. Hard checks (format, task code, blank, exact
 * duplicate) refuse the file like a virus: it is moved to quarantine/ and the task keeps its
 * earlier file. Otherwise the file becomes the task's current file with any warnings (near
 * duplicate, missing keywords, Financial Report totals). Never decides who may view a file.
 */
export function createIntegrityService({
  integrity,
  codes,
  documents,
  storage,
  tools,
  qr,
  previews,
  audit,
  cache,
  logger,
  notifications,
  onAccepted,
  settings = DEFAULT_INTEGRITY_SETTINGS,
  now = () => new Date(),
}: IntegrityServiceDeps) {
  /** The task code check: the QR on the pages, else the typed code found in the text. */
  async function checkCode(
    rec: CheckRecord,
    task: CheckTask,
    analysis: PdfAnalysis,
    textOf: () => Promise<string>,
  ): Promise<{ check: Check; codeId: string | null; matchedBy: CodeMatch | null }> {
    const none = { codeId: null, matchedBy: null };
    if (!qr) {
      return {
        check: fail('task_code', 'Task codes cannot be checked right now. Try again later.'),
        ...none,
      };
    }
    const letterFileId = rec.document.taskFile?.id ?? null;
    /** Why a code that exists does not fit this file; null when it does. */
    const mismatch = (code: { taskId: string; taskFileId: string | null }, orgId: string) => {
      if (orgId !== task.project.organization.id) {
        return 'This QR code belongs to another organization’s task.';
      }
      if (code.taskId !== task.id) {
        return 'This QR code belongs to another task. Download this task’s template and use it.';
      }
      if (letterFileId && code.taskFileId && code.taskFileId !== letterFileId) {
        return 'This QR code belongs to another Communication Letter. Each letter needs its own template.';
      }
      return null;
    };

    let firstProblem: string | null = null;
    for (const page of analysis.pages) {
      for (const content of page.qrTexts) {
        const payload = qr.verify(content);
        if (!payload) continue;
        const code = await codes.findByCode(payload.code);
        if (!code || code.taskId !== payload.taskId) continue;
        const problem = mismatch(code, payload.organizationId);
        if (!problem) {
          return {
            check: pass('task_code', `The QR code ${code.code} is this task’s.`, {
              code: code.code,
            }),
            codeId: code.id,
            matchedBy: 'qr',
          };
        }
        firstProblem ??= problem;
      }
    }
    if (firstProblem) return { check: fail('task_code', firstProblem), ...none };

    const typed = rec.integrity?.typedCode;
    if (!typed) return { check: fail('task_code', NO_CODE), ...none };
    const code = await codes.findByCode(typed);
    const problem = code ? mismatch(code, task.project.organization.id) : null;
    if (!code || problem) {
      return {
        check: fail('task_code', problem ?? `The code ${typed} is not this task’s code.`),
        ...none,
      };
    }
    // A damaged QR: the code printed under it must still be on the page.
    let found = textHasCode(await textOf(), typed);
    if (!found && analysis.pages[0])
      found = textHasCode(await tools.ocrPage(analysis.pages[0].png), typed);
    if (!found) {
      return {
        check: fail(
          'task_code',
          `The code ${typed} was not found in the file. Make sure the scan shows the code printed under the QR.`,
        ),
        ...none,
      };
    }
    return {
      check: pass('task_code', `The code ${typed} typed at upload is in the file.`, {
        code: typed,
      }),
      codeId: code.id,
      matchedBy: 'typed',
    };
  }

  async function reject(rec: CheckRecord, reason: string) {
    const quarantineKey = quarantineKeyOf(rec.storageKey);
    await storage.move(rec.storageKey, quarantineKey);
    await documents.markRefused(rec.id, { scanStatus: 'rejected', reason, quarantineKey }, now());
    await audit.record({
      action: 'quarantine',
      entityType: 'document_version',
      entityId: rec.id,
      organizationId: rec.document.organization.id,
      metadata: {
        documentId: rec.document.id,
        version: rec.version,
        scanStatus: 'rejected',
        reason,
      },
    });
    await invalidateDocuments(cache, rec.document.organization.slug);
    await notifications.notify({
      userIds: [rec.uploadedById],
      kind: 'task_file_checked',
      title: `${rec.originalFilename} was refused`,
      body: `${rec.originalFilename} (version ${rec.version} of "${rec.document.title}") was refused: ${reason} The task keeps its earlier file, if it had one. Upload it again.`,
      link: `/documents/${rec.document.id}`,
      dedupeKey: `integrity:version:${rec.id}`,
    });
    logger.warn({ versionId: rec.id, reason }, 'Task file refused by the integrity checks');
  }

  async function accept(rec: CheckRecord, warnings: IntegrityCheck[], text: string | null) {
    await documents.markClean(
      rec.id,
      { storageKey: rec.storageKey, sha256: rec.sha256!, contentText: text },
      now(),
    );
    await previews.enqueuePreview(rec.id);
    await onAccepted(rec.document.id);
    await invalidateDocuments(cache, rec.document.organization.slug);
    const verified = warnings.length === 0;
    await notifications.notify({
      userIds: [rec.uploadedById],
      kind: 'task_file_checked',
      title: verified
        ? `${rec.originalFilename} is verified ✓`
        : `${rec.originalFilename} needs attention`,
      body: verified
        ? `"${rec.document.title}" passed every check.`
        : `"${rec.document.title}" was filed, but: ${warnings.map((w) => w.message).join(' ')} Re-upload it, or your CSC or the ISSC can clear the warning, before it counts for ranking.`,
      link: `/documents/${rec.document.id}`,
      dedupeKey: `integrity:version:${rec.id}`,
    });
    logger.info(
      { versionId: rec.id, warnings: warnings.length },
      'Task file passed the integrity checks',
    );
  }

  return {
    async checkVersion(versionId: string): Promise<IntegrityOutcome> {
      const rec = await integrity.findForCheck(versionId);
      if (!rec || rec.scanStatus !== 'checking') return 'skipped';
      const task = rec.document.projectTask ?? rec.document.taskFile?.task ?? null;
      if (!task || !isCheckedTask(task.type)) {
        // Not a checked task's file any more (its task changed): file it as the scan said.
        await accept(rec, [], null);
        return 'accepted';
      }
      const checked = { ...task, type: task.type };
      const checks: Check[] = [];

      // Format: a readable PDF with pages, within the size limit.
      let analysis: PdfAnalysis | null = null;
      if (rec.mimeType !== 'application/pdf') {
        checks.push(fail('format', 'Upload the task file as a PDF scan of its template.'));
      } else if (rec.sizeBytes > MAX_UPLOAD_BYTES) {
        checks.push(fail('format', 'The file is larger than the upload limit.'));
      } else {
        try {
          analysis = await tools.analyze(await storage.read(rec.storageKey), MAX_CHECKED_PAGES);
        } catch {
          checks.push(
            fail('format', 'The PDF could not be opened: it is damaged or password-protected.'),
          );
        }
        if (analysis && analysis.totalPages < 1) {
          checks.push(fail('format', 'The PDF has no pages.'));
          analysis = null;
        }
        if (analysis) {
          checks.push(
            pass(
              'format',
              `A PDF of ${analysis.totalPages} page${analysis.totalPages === 1 ? '' : 's'}.`,
              { pages: analysis.totalPages },
            ),
          );
        }
      }
      if (!analysis) {
        await integrity.saveResults(rec.id, {
          checks,
          pageHashes: [],
          taskCodeId: null,
          matchedBy: null,
          replacesFlagged: false,
          checkedAt: now(),
        });
        await reject(rec, checks[0]!.message);
        return 'rejected';
      }
      const pdf = analysis;

      let text: string | null = null;
      const textOf = async () => (text ??= await tools.text(pdf));
      const own = task.project.organization.acronym;

      const code = await checkCode(rec, checked, pdf, textOf);
      checks.push(code.check);

      // Blank: every rendered page (nearly) without ink.
      checks.push(
        pdf.pages.every((p) => p.ink < BLANK_INK_RATIO)
          ? fail('blank', 'Every page is blank.')
          : pass('blank', 'The pages have content.'),
      );

      // Exact duplicate of another task's file, of any project or organization.
      const twin = rec.sha256 ? await integrity.exactDuplicate(rec.sha256, rec.document.id) : null;
      checks.push(
        twin
          ? fail(
              'exact_duplicate',
              `This exact file was already submitted as ${placeText(twin, own)}.`,
              { ...twin },
            )
          : pass('exact_duplicate', 'No other task has this exact file.'),
      );

      // Near duplicates: pages with content only (blank pages all hash alike).
      const pageHashes = pdf.pages.flatMap((p, i) =>
        p.ink >= BLANK_INK_RATIO * 3 ? [{ page: i + 1, hash: p.hash }] : [],
      );
      const near = await integrity.nearDuplicates(
        pageHashes.map((p) => p.hash),
        rec.document.id,
        await settings.nearDuplicateBits(),
      );
      checks.push(
        near[0]
          ? warn(
              'near_duplicate',
              `A page looks almost the same as a page of ${placeText(near[0], own)}.`,
              { matches: near.map((n) => ({ ...n })) },
            )
          : pass('near_duplicate', 'No other task’s file looks the same.'),
      );

      // Keywords, the project's name and the organization's acronym in the text (warn only).
      const fileText = await textOf();
      const keywords = (await settings.keywords())[checked.type] ?? [];
      const missing = fileText.trim()
        ? missingKeywords(fileText, { keywords, projectName: task.project.name, acronym: own })
        : null;
      checks.push(
        missing === null
          ? warn('keywords', 'The file’s text could not be read.')
          : missing.length > 0
            ? warn('keywords', `Could not find: ${missing.join(', ')}.`, { missing })
            : pass('keywords', 'The expected title, project name and acronym are in the file.'),
      );

      // Financial Report: its totals against the figures the organization entered.
      if (checked.type === 'FINANCIAL_REPORT') {
        const read = readFinancialTotals(fileText);
        const figures = task.project.figures;
        const result = figures
          ? compareFinancialTotals(figures, read)
          : { result: 'warn' as const, message: 'No figures were entered for this report.' };
        checks.push({ kind: 'financial_totals', ...result, details: { read } });
      }

      const verdict = verdictOf(checks);
      await integrity.saveResults(rec.id, {
        checks,
        pageHashes,
        taskCodeId: code.codeId,
        matchedBy: code.matchedBy,
        replacesFlagged: rec.document.versions.some((v) => v.id !== rec.id),
        checkedAt: now(),
      });
      if (!verdict.accepted) {
        await reject(rec, verdict.reason);
        return 'rejected';
      }
      if (code.codeId && rec.document.taskFile && isMultiFileTask(checked.type)) {
        await integrity.bindCode(code.codeId, rec.document.taskFile.id);
      }
      await accept(rec, verdict.warnings, fileText || null);
      return 'accepted';
    },
  };
}

type CheckTask = NonNullable<CheckRecord['document']['projectTask']>;

export type IntegrityService = ReturnType<typeof createIntegrityService>;
