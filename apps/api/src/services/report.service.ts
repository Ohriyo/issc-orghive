import { randomUUID } from 'node:crypto';
import {
  PROJECT_TASK_LABELS,
  REPORT_DOCUMENT_TYPE,
  reportTitle,
  SEMESTER_LABELS,
  semesterRange,
  type GenerateReportRequest,
  type ProjectTaskType,
  type SemestralReport,
  type SemestralReportListResponse,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { type Cache, cacheKeys } from '#src/lib/cache';
import type { ReportQueue } from '#src/lib/queue';
import {
  assembleReport,
  loadSource,
  pagesOfSource,
  type AssemblyStep,
  type HtmlToPdf,
  type LoadedSource,
} from '#src/lib/report-pdf';
import { renderReportHtml, type TemplatePage } from '#src/lib/report-template';
import type { Storage } from '#src/lib/storage';
import type { Logger } from '#src/logger';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { DocumentRepository } from '#src/repositories/document.repository';
import type { DocumentTypeRepository } from '#src/repositories/document-type.repository';
import type {
  ReportOrgRecord,
  ReportProjectRecord,
  ReportRecord,
  ReportRepository,
} from '#src/repositories/report.repository';
import type { OrgRef } from './access.service';
import type { Actor } from './document.service';
import type { NotificationService } from './notification.service';
import {
  paginate,
  planReport,
  TOC_ROWS_PER_PAGE,
  tocPageCount,
  type ReportPart,
  type ReportProject,
} from './report-rules';

export interface ReportServiceDeps {
  reports: ReportRepository;
  documents: Pick<DocumentRepository, 'create'>;
  documentTypes: Pick<DocumentTypeRepository, 'findBySlug'>;
  storage: Pick<Storage, 'read' | 'put'>;
  queue: ReportQueue;
  /** Opens a renderer for one report (Chromium in production). */
  renderer: () => Promise<HtmlToPdf>;
  /** Page-1 preview, as for uploads; optional, a failure never fails the report. */
  thumbnail?: (pdf: Uint8Array) => Promise<Buffer>;
  sha256: (bytes: Uint8Array) => string;
  notifications: Pick<NotificationService, 'notify'>;
  audit: Pick<AuditLogRepository, 'record'>;
  cache: Pick<Cache, 'deleteMatching'>;
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
  now?: () => Date;
}

const LEVELS: Record<ReportOrgRecord['type'], string> = {
  ISSC: 'Institutional Supreme Student Council',
  CSC: 'Collegiate Student Council',
  SBO: 'Student Body Organization',
};

const longDate = new Intl.DateTimeFormat('en-PH', { dateStyle: 'long', timeZone: 'Asia/Manila' });
/** A DATE (`YYYY-MM-DD`) as "October 20, 2026". */
const dayLabel = (isoDate: string) => longDate.format(new Date(`${isoDate}T12:00:00+08:00`));

function toReport(rec: ReportRecord): SemestralReport {
  const doc = rec.document;
  const current = doc && !doc.deletedAt && doc.currentVersionId ? doc : null;
  return {
    id: rec.id,
    academicYear: rec.academicYear,
    semester: rec.semester,
    status: rec.status,
    progress: rec.progress,
    error: rec.error,
    requestedBy: { name: rec.requestedBy.name },
    createdAt: rec.createdAt.toISOString(),
    finishedAt: rec.finishedAt?.toISOString() ?? null,
    // A report whose document was since deleted shows no link.
    document: current && {
      id: current.id,
      title: current.title,
      versionId: current.currentVersionId!,
    },
  };
}

function toReportProject(p: ReportProjectRecord): ReportProject {
  const files: ReportProject['files'] = {};
  for (const task of p.tasks) {
    const version = task.document?.currentVersion;
    if (version && version.scanStatus === 'clean') {
      files[task.type] = { storageKey: version.storageKey, mimeType: version.mimeType };
    }
  }
  return {
    id: p.id,
    name: p.name,
    targetDate: p.targetDate.toISOString().slice(0, 10),
    location: p.location,
    beneficiaries: p.beneficiaries,
    nomRequired: p.nomRequired,
    momRequired: p.momRequired,
    files,
  };
}

/** Thrown for problems the officer can act on; anything else is "something went wrong". */
class ReportError extends Error {}

/**
 * The Semestral End Report (docs/PROJECT_WORKFLOW_SPEC.md, section 4). An officer asks; the
 * worker compiles every submitted task file of the organization's projects in that semester
 * into one PDF in the fixed order (report-rules.ts), files it as a private document of the
 * organization, and tells the officer. Nothing is reviewed.
 */
export function createReportService({
  reports,
  documents,
  documentTypes,
  storage,
  queue,
  renderer,
  thumbnail,
  sha256,
  notifications,
  audit,
  cache,
  logger,
  now = () => new Date(),
}: ReportServiceDeps) {
  /** The report's own pages and the merge order, from the plan and the loaded files. */
  function layout(
    org: ReportOrgRecord,
    request: { academicYear: string; semester: ReportRecord['semester'] },
    projects: ReportProject[],
    parts: ReportPart[],
    sources: Map<number, LoadedSource>,
  ) {
    const tocPages = tocPageCount(parts);
    const { toc, totalPages } = paginate(parts, (part, i) =>
      part.kind === 'toc' ? tocPages : part.kind === 'file' ? pagesOfSource(sources.get(i)!) : 1,
    );
    const pages: TemplatePage[] = [];
    const steps: AssemblyStep[] = [];
    const generated = (page: TemplatePage) => {
      steps.push({ kind: 'generated', page: pages.length });
      pages.push(page);
    };
    const placeholder = (
      project: ReportProject,
      task: ProjectTaskType,
      reason: 'missing' | 'unreadable',
    ) =>
      generated({
        kind: 'placeholder',
        projectName: project.name,
        taskLabel: PROJECT_TASK_LABELS[task],
        reason,
      });

    parts.forEach((part, i) => {
      switch (part.kind) {
        case 'cover':
          return generated({
            kind: 'cover',
            org: {
              name: org.name,
              acronym: org.acronym,
              level: LEVELS[org.type],
              college: org.college?.name ?? null,
            },
            semester: SEMESTER_LABELS[request.semester],
            academicYear: request.academicYear,
            generatedOn: longDate.format(now()),
            projectCount: projects.length,
          });
        case 'toc':
          for (let page = 0; page < tocPages; page++) {
            generated({
              kind: 'toc',
              rows: toc.slice(page * TOC_ROWS_PER_PAGE, (page + 1) * TOC_ROWS_PER_PAGE),
              part: page + 1,
              parts: tocPages,
            });
          }
          return;
        case 'divider':
          return generated({
            kind: 'divider',
            number: projects.indexOf(part.project) + 1,
            total: projects.length,
            project: {
              name: part.project.name,
              eventDate: dayLabel(part.project.targetDate),
              location: part.project.location,
              beneficiaries: part.project.beneficiaries,
            },
          });
        case 'missing':
          return placeholder(part.project, part.task, 'missing');
        case 'file': {
          const source = sources.get(i)!;
          if (source.kind === 'unreadable')
            return placeholder(part.project, part.task, 'unreadable');
          steps.push({ kind: 'source', source });
          return;
        }
      }
    });
    return { pages, steps, totalPages };
  }

  async function build(rec: ReportRecord, progress: (n: number) => Promise<void>) {
    const org = await reports.findOrganization(rec.organizationId);
    if (!org) throw new ReportError('The organization no longer exists.');
    const docType = await documentTypes.findBySlug(REPORT_DOCUMENT_TYPE.slug);
    if (!docType)
      throw new Error(`Document type ${REPORT_DOCUMENT_TYPE.slug} is missing; run the migrations`);

    const range = semesterRange(rec.academicYear, rec.semester);
    const records = await reports.projectsBetween(org.id, range.start, range.end);
    const { projects, parts } = planReport(records.map(toReportProject));
    await progress(5);

    // Read each submitted file once, from storage (never through the API's clients).
    const files = parts.flatMap((part, i) => (part.kind === 'file' ? [{ part, i }] : []));
    const sources = new Map<number, LoadedSource>();
    for (const [n, { part, i }] of files.entries()) {
      const bytes = await storage.read(part.file.storageKey);
      const source = await loadSource(new Uint8Array(bytes), part.file.mimeType);
      if (source.kind === 'unreadable') {
        logger.warn(
          { reportId: rec.id, projectId: part.project.id, task: part.task },
          'Report: file could not be merged',
        );
      }
      sources.set(i, source);
      await progress(5 + Math.round(((n + 1) / Math.max(files.length, 1)) * 55));
    }

    const { pages, steps, totalPages } = layout(org, rec, projects, parts, sources);
    const html = renderReportHtml(pages);
    const browser = await renderer();
    let generated: Uint8Array;
    try {
      generated = await browser.render(html);
    } finally {
      await browser.close();
    }
    await progress(70);

    const title = reportTitle(org.acronym, rec.academicYear, rec.semester);
    const assembled = await assembleReport(
      generated,
      steps,
      { title, author: org.name, now: now() },
      (done, total) => {
        void progress(70 + Math.round((done / total) * 20));
      },
    );
    // The contents were numbered in advance: the merged PDF must have exactly those pages.
    if (assembled.pages !== totalPages) {
      throw new Error(
        `The report has ${assembled.pages} pages; its contents expected ${totalPages}`,
      );
    }

    const key = `reports/${org.id}/${randomUUID()}.pdf`;
    await storage.put(key, Buffer.from(assembled.bytes), 'application/pdf');
    let thumbnailKey: string | null = null;
    if (thumbnail) {
      try {
        thumbnailKey = `thumbnails/reports/${rec.id}.webp`;
        await storage.put(thumbnailKey, await thumbnail(assembled.bytes), 'image/webp');
      } catch (err) {
        thumbnailKey = null;
        logger.warn({ err, reportId: rec.id }, 'Report: could not render a preview');
      }
    }
    const filename = `${org.slug}-semestral-end-report-${rec.academicYear}-${rec.semester}.pdf`;
    const doc = await documents.create({
      organizationId: org.id,
      typeId: docType.id,
      title,
      academicYear: rec.academicYear,
      semester: rec.semester,
      // Generated by the server from files that already passed the scan: available at once,
      // seen by the organization's officers only until they choose otherwise.
      status: 'available',
      visibility: 'private',
      createdById: rec.requestedById,
      firstVersion: {
        storageKey: key,
        originalFilename: filename,
        mimeType: 'application/pdf',
        sizeBytes: assembled.bytes.length,
        sha256: sha256(assembled.bytes),
        scanStatus: 'clean',
        uploadedById: rec.requestedById,
        thumbnailKey,
        processedAt: now(),
      },
    });
    return { org, doc, pages: assembled.pages, projects: projects.length };
  }

  return {
    /** An officer asks for a report; the worker makes it. 409 while one for it is running. */
    async request(
      actor: Actor,
      org: OrgRef,
      input: GenerateReportRequest,
    ): Promise<SemestralReport> {
      const created = await reports.create({
        organizationId: org.id,
        academicYear: input.academicYear,
        semester: input.semester,
        requestedById: actor.userId,
      });
      if (created.status === 'running') {
        throw AppError.conflict(
          `A report for the ${SEMESTER_LABELS[input.semester]} of ${input.academicYear} is already being generated.`,
        );
      }
      await audit.record({
        action: 'report_generate',
        actorId: actor.userId,
        entityType: 'semestral_report',
        entityId: created.report.id,
        organizationId: org.id,
        metadata: { academicYear: input.academicYear, semester: input.semester },
        ip: actor.ip,
      });
      try {
        await queue.enqueueReport(created.report.id);
      } catch (err) {
        await reports.fail(created.report.id, 'The report could not be started. Try again.', now());
        throw err;
      }
      return toReport(created.report);
    },

    /** The organization's latest reports, with progress and the finished document. */
    async list(org: OrgRef): Promise<SemestralReportListResponse> {
      return { items: (await reports.listByOrganization(org.id)).map(toReport) };
    },

    /**
     * The worker's half. Never throws for a report it could not make: it records why and
     * tells the officer, who can try again. Skips reports that already finished.
     */
    async generate(reportId: string): Promise<'ready' | 'failed' | 'skipped'> {
      const rec = await reports.findById(reportId);
      if (!rec || !(await reports.start(reportId, now()))) return 'skipped';
      const started = Date.now();
      try {
        const result = await build(rec, (n) => reports.setProgress(reportId, Math.min(n, 99)));
        await reports.finish(reportId, result.doc.id, now());
        await cache.deleteMatching(cacheKeys.organizationDocumentsPattern(result.org.slug));
        await audit.record({
          action: 'upload',
          actorId: rec.requestedById,
          entityType: 'document',
          entityId: result.doc.id,
          organizationId: rec.organizationId,
          metadata: { generated: 'semestral_end_report', reportId, pages: result.pages },
        });
        await notifications.notify({
          userIds: [rec.requestedById],
          kind: 'report_ready',
          title: 'Your Semestral End Report is ready',
          body: `${reportTitle(result.org.acronym, rec.academicYear, rec.semester)} has ${result.pages} pages covering ${result.projects} ${result.projects === 1 ? 'project' : 'projects'}. Only your organization's officers can see it.`,
          link: `/documents/${result.doc.id}`,
          dedupeKey: `report-ready:${reportId}`,
        });
        logger.info(
          { reportId, pages: result.pages, ms: Date.now() - started },
          'Semestral End Report ready',
        );
        return 'ready';
      } catch (err) {
        const message =
          err instanceof ReportError
            ? err.message
            : 'Something went wrong while making the report. Try again.';
        logger.error({ err, reportId }, 'Semestral End Report failed');
        await reports.fail(reportId, message, now());
        await notifications.notify({
          userIds: [rec.requestedById],
          kind: 'report_ready',
          title: 'Your Semestral End Report could not be made',
          body: `${message} (${SEMESTER_LABELS[rec.semester]} ${rec.academicYear})`,
          link: '/dashboard',
          dedupeKey: `report-failed:${reportId}`,
        });
        return 'failed';
      }
    },
  };
}

export type ReportService = ReturnType<typeof createReportService>;
