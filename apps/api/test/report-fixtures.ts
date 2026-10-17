import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pino } from 'pino';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { chromium } from 'playwright-core';
import { extractText, getDocumentProxy } from 'unpdf';
import { REPORT_DOCUMENT_TYPE, type ProjectTaskType } from '@orghive/shared';
import { memoryCache } from '#src/lib/cache';
import { sha256Hex } from '#src/lib/file-processing';
import { createChromiumRenderer, type HtmlToPdf } from '#src/lib/report-pdf';
import type { Storage } from '#src/lib/storage';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createDocumentTypeRepository } from '#src/repositories/document-type.repository';
import type { Db } from '#src/repositories/prisma';
import { createProjectRepository } from '#src/repositories/project.repository';
import { createReportRepository } from '#src/repositories/report.repository';
import { planProject } from '#src/services/project-rules';
import { createReportService } from '#src/services/report.service';

/** Made with the pdf skill (reportlab + Pillow); each page carries "FIXTURE-<NAME> page n of N". */
export const FIXTURES = join(import.meta.dirname, 'fixtures', 'reports');
export const FIXTURE_FILES = {
  proposal: { file: 'proposal-1p.pdf', mime: 'application/pdf', pages: 1 },
  nom: { file: 'nom-1p.pdf', mime: 'application/pdf', pages: 1 },
  mom: { file: 'mom-2p.pdf', mime: 'application/pdf', pages: 2 },
  acr: { file: 'acr-3p.pdf', mime: 'application/pdf', pages: 3 },
  financial: { file: 'financial-2p.pdf', mime: 'application/pdf', pages: 2 },
  photo: { file: 'photo.jpg', mime: 'image/jpeg', pages: 1 },
  wide: { file: 'wide.png', mime: 'image/png', pages: 1 },
  broken: { file: 'broken.pdf', mime: 'application/pdf', pages: 1 },
} as const;
export type FixtureName = keyof typeof FIXTURE_FILES;

/** Real Chromium when it is installed (`playwright install chromium`); CI may lack it. */
export const chromiumInstalled = existsSync(chromium.executablePath());

/**
 * Without Chromium: one PDF page per template page with that page's text, so the same order
 * and page-count checks run. The real template is covered when Chromium is present.
 */
export function textRenderer(): HtmlToPdf {
  return {
    async render(html) {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const sections = html.split('<section').slice(1);
      for (const section of sections) {
        const text = section
          .replace(/<style[\s\S]*?<\/style>/g, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&#39;/g, "'")
          .replace(/[^\x20-\x7e]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const page = doc.addPage([595.28, 841.89]);
        text.match(/.{1,90}/g)?.forEach((line, i) => {
          page.drawText(line, { x: 40, y: 800 - i * 14, size: 9, font });
        });
      }
      return doc.save();
    },
    close: () => Promise.resolve(),
  };
}

export const testRenderer = (): Promise<HtmlToPdf> =>
  chromiumInstalled ? createChromiumRenderer() : Promise.resolve(textRenderer());

/**
 * Storage stand-in: `fixtures/<file>?<id>` reads the fixture (the suffix keeps storage keys
 * unique, as the database requires); puts are kept in memory.
 */
export function fixtureStorage() {
  const stored = new Map<string, Buffer>();
  const failing = new Set<string>();
  const storage: Pick<Storage, 'read' | 'put'> = {
    read: (key) => {
      if (failing.has(key)) return Promise.reject(new Error('storage unavailable'));
      if (key.startsWith('fixtures/')) {
        const file = key.slice('fixtures/'.length).replace(/\?.*$/, '');
        return Promise.resolve(readFileSync(join(FIXTURES, file)));
      }
      const body = stored.get(key);
      return body ? Promise.resolve(body) : Promise.reject(new Error(`No object ${key}`));
    },
    put: (key, body) => {
      stored.set(key, body);
      return Promise.resolve();
    },
  };
  return { storage, stored, failing };
}

/** A project whose `files` tasks already have a clean file read from a fixture. */
export async function seedReportProject(
  db: Db,
  input: {
    organizationId: string;
    createdById: string;
    name: string;
    targetDate: string;
    nomRequired?: boolean;
    momRequired?: boolean;
    files?: Partial<Record<ProjectTaskType, FixtureName>>;
  },
) {
  const projects = createProjectRepository(db);
  const createdAt = new Date(`${input.targetDate}T00:00:00+08:00`);
  createdAt.setUTCDate(createdAt.getUTCDate() - 20);
  const fields = {
    organizationId: input.organizationId,
    name: input.name,
    targetDate: input.targetDate,
    location: 'CEA Building, NwSSU Main Campus',
    beneficiaries: 'Civil engineering students',
    description: 'A project.',
    nomRequired: input.nomRequired ?? false,
    momRequired: input.momRequired ?? false,
    createdById: input.createdById,
    createdAt,
  };
  const plan = planProject(
    { ...fields, proposalDueOverride: null, postEventDueOverride: null, filed: new Set() },
    createdAt,
  );
  const project = await projects.create(fields, plan);
  const type = await db.documentType.findUniqueOrThrow({ where: { slug: 'project-proposal' } });
  for (const [task, name] of Object.entries(input.files ?? {}) as [
    ProjectTaskType,
    FixtureName,
  ][]) {
    const fixture = FIXTURE_FILES[name];
    const doc = await db.document.create({
      data: {
        organizationId: input.organizationId,
        typeId: type.id,
        title: `${input.name} ${task}`,
        academicYear: '2026-2027',
        status: 'available',
        visibility: 'members',
        createdById: input.createdById,
      },
    });
    const version = await db.documentVersion.create({
      data: {
        documentId: doc.id,
        version: 1,
        storageKey: `fixtures/${fixture.file}?${doc.id}`,
        originalFilename: fixture.file,
        mimeType: fixture.mime,
        sizeBytes: 1,
        sha256: 'x'.repeat(64),
        scanStatus: 'clean',
        uploadedById: input.createdById,
      },
    });
    await db.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
    await projects.linkDocument(project.id, task, doc.id);
  }
  return project;
}

export async function ensureReportDocumentType(db: Db) {
  await db.documentType.upsert({
    where: { slug: REPORT_DOCUMENT_TYPE.slug },
    create: REPORT_DOCUMENT_TYPE,
    update: {},
  });
}

/** The report service on the test database, with in-memory storage, queue and notifications. */
export function buildReportService(db: Db, now?: () => Date) {
  const { storage, stored, failing } = fixtureStorage();
  const queued: string[] = [];
  const notified: { userIds: string[]; title: string; link: string | null }[] = [];
  const service = createReportService({
    reports: createReportRepository(db),
    documents: createDocumentRepository(db),
    documentTypes: createDocumentTypeRepository(db),
    storage,
    queue: {
      enqueueReport: (id) => {
        queued.push(id);
        return Promise.resolve();
      },
    },
    renderer: testRenderer,
    sha256: sha256Hex,
    notifications: {
      notify: (input) => {
        notified.push({ userIds: input.userIds, title: input.title, link: input.link });
        return Promise.resolve();
      },
    },
    audit: createAuditLogRepository(db),
    cache: memoryCache(),
    logger: pino({ level: 'silent' }),
    now,
  });
  return { service, stored, failing, queued, notified };
}

/** The text of each page of a PDF, in order. */
export async function pageTexts(pdf: Uint8Array): Promise<string[]> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const { text } = await extractText(doc, { mergePages: false });
  return text.map((t) => t.replace(/\s+/g, ' '));
}
