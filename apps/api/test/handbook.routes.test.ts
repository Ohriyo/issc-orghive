import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  HANDBOOK_DOCUMENT_TYPE,
  type AdminHandbookResponse,
  type HandbookEditionList,
  type HandbookResponse,
  type HandbookSearchResponse,
  type SearchResponse,
} from '@orghive/shared';
import { invalidateDocuments, memoryCache } from '#src/lib/cache';
import type { Storage } from '#src/lib/storage';
import { createAccountRepository } from '#src/repositories/account.repository';
import { createAdminOrganizationRepository } from '#src/repositories/admin-organization.repository';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createDocumentTypeRepository } from '#src/repositories/document-type.repository';
import { createHandbookRepository } from '#src/repositories/handbook.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { createProjectRepository } from '#src/repositories/project.repository';
import { createUploadIntentRepository } from '#src/repositories/upload-intent.repository';
import { createAccessService } from '#src/services/access.service';
import { createAdminOrganizationService } from '#src/services/admin-organization.service';
import { createDocumentPreviewService } from '#src/services/document-preview.service';
import { createDocumentService } from '#src/services/document.service';
import { createDocumentViewerService } from '#src/services/document-viewer.service';
import { createHandbookService } from '#src/services/handbook.service';
import { createPageTokenService } from '#src/services/page-token.service';
import { createSearchService } from '#src/services/search.service';
import { createTokenService } from '#src/services/token.service';
import { createUploadService } from '#src/services/upload.service';
import { createPublicUrl } from '#src/lib/public-url';
import { testKeys } from './auth-fixtures';
import { buildWorld, resetDb, testDb, type World } from './db';
import { buildTestApp } from './helpers';

const db = testDb();
const tokens = createTokenService(testKeys());
const cache = memoryCache();
const documents = createDocumentRepository(db);
const deleted: string[] = [];

const storage: Storage = {
  presignPut: (key) => Promise.resolve({ url: `https://storage.test/${key}`, headers: {} }),
  presignGet: (key) => Promise.resolve(`https://storage.test/${key}?signed`),
  head: async (key) => {
    const intent = await db.uploadIntent.findUnique({ where: { key } });
    return intent ? { sizeBytes: intent.sizeBytes, contentType: intent.contentType } : null;
  },
  read: (key) => Promise.resolve(Buffer.from(`webp:${key}`)),
  put: () => Promise.resolve(),
  copy: () => Promise.resolve(),
  move: () => Promise.resolve(),
  delete: (key) => {
    deleted.push(key);
    return Promise.resolve();
  },
};
const queued: string[] = [];
const queue = {
  enqueueProcessing: (versionId: string) => {
    queued.push(versionId);
    return Promise.resolve();
  },
};

type Person = 'issc' | 'jpice' | 'governor';
let world: World;
let app: ReturnType<typeof buildTestApp>;
let uploads: ReturnType<typeof createUploadService>;
const tokenOf = {} as Record<Person, string>;

beforeAll(async () => {
  await resetDb(db);
  world = await buildWorld(db);
  await db.documentType.create({ data: HANDBOOK_DOCUMENT_TYPE });
  const people: Record<Person, string> = {
    issc: world.users.issc.id,
    jpice: world.users.officer.id,
    governor: world.users.governor.id,
  };
  for (const [key, userId] of Object.entries(people) as [Person, string][]) {
    tokenOf[key] = (await tokens.sign({ userId, passwordChangeRequired: false })).token;
  }

  const accounts = createAccountRepository(db);
  const organizations = createOrganizationRepository(db);
  const audit = createAuditLogRepository(db);
  const viewers = createDocumentViewerService({ accounts });
  const documentTypes = createDocumentTypeRepository(db);
  uploads = createUploadService({ intents: createUploadIntentRepository(db), storage });
  const handbook = createHandbookService({
    handbooks: createHandbookRepository(db),
    documents,
    documentTypes,
    organizations,
    viewers,
    uploads,
    queue,
    storage,
    audit,
    cache,
  });
  app = buildTestApp({
    tokens,
    uploads,
    handbook,
    search: createSearchService({ documents, viewers, storage, cache, handbook }),
    documents: createDocumentService({
      documents,
      documentTypes,
      organizations,
      viewers,
      uploads,
      queue,
      storage,
      audit,
      cache,
    }),
    documentPreviews: createDocumentPreviewService({
      documents,
      viewers,
      pageTokens: createPageTokenService(testKeys()),
      storage,
    }),
    adminOrganizations: createAdminOrganizationService({
      admin: createAdminOrganizationRepository(db),
      audit,
      cache,
      storage,
      publicUrl: createPublicUrl('https://cdn.test'),
    }),
    access: createAccessService({
      accounts,
      organizations,
      documents,
      projects: createProjectRepository(db),
    }),
  });
});

function call(
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  who?: Person,
  body?: object,
) {
  let req = request(app)[method](`/api/v1${path}`);
  if (who) req = req.set('Authorization', `Bearer ${tokenOf[who]}`);
  return body ? req.send(body) : req;
}

async function uploadKey(contentType = 'application/pdf', filename = 'handbook.pdf') {
  const issued = await uploads.issueUrl(
    world.users.issc.id,
    { id: world.orgs.issc.id, slug: 'issc' },
    { filename, contentType: contentType as 'application/pdf', sizeBytes: 4096 },
  );
  return issued.uploadKey;
}

/** The worker: the file is clean and its pages, bookmarks and texts are rendered. */
async function processed(versionId: string, texts: string[]) {
  await documents.markClean(
    versionId,
    { storageKey: `files/${versionId}`, sha256: 'a'.repeat(64), contentText: texts.join(' ') },
    new Date(),
  );
  await documents.markPreviewReady(versionId, {
    pages: texts.map(() => [1240, 1754]),
    pageCount: texts.length,
    thumbnailKey: `thumbnails/x/${versionId}.webp`,
    handbook: {
      outline: [{ title: 'Dress code', page: 2, items: [] }],
      pageTexts: texts,
    },
  });
  await invalidateDocuments(cache, 'issc');
}

const versionsOf = (body: unknown, year: string) =>
  (body as AdminHandbookResponse).editions.find((e) => e.academicYear === year)!.versions;

describe('the Student Handbook routes: who may call them', () => {
  it('401s the admin routes signed out', async () => {
    expect((await call('get', '/admin/handbook')).status).toBe(401);
    expect(
      (await call('post', '/admin/handbook', undefined, { academicYear: '2026-2027' })).status,
    ).toBe(401);
    expect(
      (await call('put', '/admin/handbook/2026-2027/current', undefined, { actingAs: 'Ana' }))
        .status,
    ).toBe(401);
  });

  it('403s every account but the ISSC', async () => {
    for (const who of ['jpice', 'governor'] as const) {
      expect((await call('get', '/admin/handbook', who)).status).toBe(403);
      expect(
        (
          await call('post', '/admin/handbook', who, {
            uploadKey: await uploadKey(),
            actingAs: 'Ana',
            academicYear: '2026-2027',
          })
        ).status,
      ).toBe(403);
      expect(
        (await call('put', '/admin/handbook/2026-2027/current', who, { actingAs: 'Ana' })).status,
      ).toBe(403);
    }
  });

  it('answers the public reads with nothing before an edition is readable', async () => {
    expect((await call('get', '/handbook')).body).toEqual({ edition: null });
    expect((await call('get', '/handbook/editions')).body).toEqual({ editions: [] });
    expect((await call('get', '/handbook/2026-2027')).status).toBe(404);
    expect((await call('get', '/handbook/not-a-year')).status).toBe(400);
  });
});

describe('the Student Handbook, end to end', () => {
  it('uploads, publishes, searches, versions and switches the current edition', async () => {
    // A non-PDF is refused and its upload deleted.
    const png = await uploadKey('image/png', 'cover.png');
    const refused = await call('post', '/admin/handbook', 'issc', {
      uploadKey: png,
      actingAs: 'Ana Reyes',
      academicYear: '2026-2027',
    });
    expect(refused.status).toBe(400);
    expect(deleted).toContain(png);

    // The first edition is current by itself.
    const first = await call('post', '/admin/handbook', 'issc', {
      uploadKey: await uploadKey(),
      actingAs: 'Ana Reyes',
      academicYear: '2026-2027',
    });
    expect(first.status).toBe(201);
    const [v1] = versionsOf(first.body, '2026-2027');
    expect(v1).toMatchObject({ version: 1, scanStatus: 'pending', actingAs: 'Ana Reyes' });
    expect((first.body as AdminHandbookResponse).editions[0]).toMatchObject({
      isCurrent: true,
      readable: false,
    });
    expect(queued).toContain(v1!.id);
    expect((await call('get', '/handbook')).body).toEqual({ edition: null });

    await processed(v1!.id, ['Welcome to NwSSU', 'The dress code applies on campus', 'Grading']);
    const current = (await call('get', '/handbook')).body as HandbookResponse;
    expect(current.edition).toMatchObject({
      academicYear: '2026-2027',
      isCurrent: true,
      pageCount: 3,
      outline: [{ title: 'Dress code', page: 2, items: [] }],
      thumbnails: true,
      coverUrl: `https://storage.test/thumbnails/x/${v1!.id}.webp?signed`,
    });

    // Search inside, by prefix, jumping to the page.
    const found = (await call('get', '/handbook/search?q=dres')).body as HandbookSearchResponse;
    expect(found.matches.map((m) => m.page)).toEqual([2]);
    expect(found.matches[0]!.snippet.some((part) => part.match && /dress/i.test(part.text))).toBe(true);
    expect((await call('get', '/handbook/2026-2027/search?q=grading')).body).toMatchObject({
      matches: [{ page: 3 }],
    });
    expect((await call('get', '/handbook/search?q=x')).status).toBe(400);

    // The site search lists its pages above the documents, never the document itself.
    const site = (await call('get', '/search?q=dress')).body as SearchResponse;
    expect(site.handbook).toMatchObject({ academicYear: '2026-2027', matches: [{ page: 2 }] });
    expect(site.items.some((hit) => hit.document.type.slug === 'student-handbook')).toBe(false);

    // Next year's edition waits; it cannot be made current until it is readable.
    const next = await call('post', '/admin/handbook', 'issc', {
      uploadKey: await uploadKey(),
      actingAs: 'Ben Cruz',
      academicYear: '2027-2028',
    });
    const nextEdition = (next.body as AdminHandbookResponse).editions.find(
      (e) => e.academicYear === '2027-2028',
    )!;
    expect(nextEdition.isCurrent).toBe(false);
    expect(
      (await call('put', '/admin/handbook/2027-2028/current', 'issc', { actingAs: 'Ben Cruz' }))
        .status,
    ).toBe(409);
    await processed(nextEdition.versions[0]!.id, ['Welcome', 'New dress code']);
    const switched = await call('put', '/admin/handbook/2027-2028/current', 'issc', {
      actingAs: 'Ben Cruz',
    });
    expect(switched.status).toBe(200);
    expect(
      (switched.body as AdminHandbookResponse).editions.map((e) => [e.academicYear, e.isCurrent]),
    ).toEqual([
      ['2027-2028', true],
      ['2026-2027', false],
    ]);
    const audited = await db.auditLog.findFirst({ where: { action: 'handbook_current' } });
    expect(audited?.actingAs).toBe('Ben Cruz');

    expect(((await call('get', '/handbook')).body as HandbookResponse).edition?.academicYear).toBe(
      '2027-2028',
    );
    const editions = (await call('get', '/handbook/editions')).body as HandbookEditionList;
    expect(editions.editions.map((e) => [e.academicYear, e.isCurrent])).toEqual([
      ['2027-2028', true],
      ['2026-2027', false],
    ]);
    expect(((await call('get', '/handbook/2026-2027')).body as HandbookResponse).edition).toMatchObject(
      { academicYear: '2026-2027', isCurrent: false },
    );

    // A corrected version of a past year: the edition's next version.
    const corrected = await call('post', '/admin/handbook', 'issc', {
      uploadKey: await uploadKey(),
      actingAs: 'Ana Reyes',
      academicYear: '2026-2027',
    });
    expect(versionsOf(corrected.body, '2026-2027').map((v) => v.version)).toEqual([2, 1]);
  });

  it('lets only the ISSC download it, and refuses the document actions', async () => {
    const edition = ((await call('get', '/handbook')).body as HandbookResponse).edition!;
    const download = `/documents/${edition.documentId}/versions/${edition.versionId}/download-url`;
    expect((await call('get', download)).status).toBe(401);
    expect((await call('get', download, 'governor')).status).toBe(403);
    expect((await call('get', download, 'jpice')).status).toBe(403);
    expect((await call('get', download, 'issc')).status).toBe(200);

    expect(
      (
        await call('patch', `/documents/${edition.documentId}/visibility`, 'issc', {
          visibility: 'private',
        })
      ).status,
    ).toBe(409);
    expect(
      (await call('delete', `/documents/${edition.documentId}`, 'issc', { actingAs: 'Ana' }))
        .status,
    ).toBe(409);
    expect(
      (await call('post', `/documents/${edition.documentId}/archive`, 'issc', { actingAs: 'Ana' }))
        .status,
    ).toBe(409);
  });

  it('serves the contents thumbnails through a page token', async () => {
    const edition = ((await call('get', '/handbook')).body as HandbookResponse).edition!;
    const viewer = await call('get', `/documents/${edition.documentId}/viewer`);
    const token = (viewer.body as { token: string }).token;
    const thumb = await call(
      'get',
      `/documents/${edition.documentId}/pages/1?token=${encodeURIComponent(token)}&size=thumb`,
    );
    expect(thumb.status).toBe(200);
    expect((thumb.body as Buffer).toString()).toContain('/thumbs/1.webp');
  });
});
