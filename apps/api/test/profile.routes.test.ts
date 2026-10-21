import sharp from 'sharp';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CONSTITUTION_DOCUMENT_TYPE,
  type ConstitutionResponse,
  type OrganizationDetail,
} from '@orghive/shared';
import { invalidateDocuments, memoryCache } from '#src/lib/cache';
import { createPublicUrl } from '#src/lib/public-url';
import type { Storage } from '#src/lib/storage';
import { createAccountRepository } from '#src/repositories/account.repository';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createDocumentTypeRepository } from '#src/repositories/document-type.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { createProfileRepository } from '#src/repositories/profile.repository';
import { createProjectRepository } from '#src/repositories/project.repository';
import { createUploadIntentRepository } from '#src/repositories/upload-intent.repository';
import { createAccessService } from '#src/services/access.service';
import { createConstitutionService } from '#src/services/constitution.service';
import { createDocumentPreviewService } from '#src/services/document-preview.service';
import { createDocumentService } from '#src/services/document.service';
import { createDocumentViewerService } from '#src/services/document-viewer.service';
import { createOrganizationService } from '#src/services/organization.service';
import { createPageTokenService } from '#src/services/page-token.service';
import { createProfileService } from '#src/services/profile.service';
import { createTokenService } from '#src/services/token.service';
import { createUploadService } from '#src/services/upload.service';
import { testKeys } from './auth-fixtures';
import { buildWorld, resetDb, testDb, type World } from './db';
import { buildTestApp } from './helpers';

const db = testDb();
const tokens = createTokenService(testKeys());
const stored: string[] = [];

/** An upload "exists" once its intent does, with exactly the declared size and type. */
const storage: Storage = {
  presignPut: (key) => Promise.resolve({ url: `https://storage.test/${key}`, headers: {} }),
  presignGet: (key) => Promise.resolve(`https://storage.test/${key}?get`),
  head: async (key) => {
    const intent = await db.uploadIntent.findUnique({ where: { key } });
    return intent ? { sizeBytes: intent.sizeBytes, contentType: intent.contentType } : null;
  },
  read: () => Promise.reject(new Error('not read here')),
  put: (key) => {
    stored.push(key);
    return Promise.resolve();
  },
  copy: () => Promise.resolve(),
  move: () => Promise.resolve(),
  delete: () => Promise.resolve(),
};
const queued: string[] = [];
const queue = {
  enqueueProcessing: (versionId: string) => {
    queued.push(versionId);
    return Promise.resolve();
  },
};

type Person = 'owner' | 'governor' | 'admin' | 'student';
let world: World;
let app: ReturnType<typeof buildTestApp>;
let uploads: ReturnType<typeof createUploadService>;
const tokenOf = {} as Record<Person, string>;
const documents = createDocumentRepository(db);
const cache = memoryCache();

/** What the worker does once a file passes the scan: it becomes current, the lists clear. */
async function scanClean(versionId: string) {
  await documents.markClean(
    versionId,
    { storageKey: `files/${versionId}`, sha256: 'a'.repeat(64), contentText: null },
    new Date(),
  );
  await invalidateDocuments(cache, 'jpice');
}

const PROFILE = {
  description: 'Civil engineering students.',
  mission: 'Shape competent civil engineers.',
  vision: '',
  contactEmail: 'jpice@nwssu.edu.ph',
  facebookUrl: 'https://facebook.com/jpice.nwssu',
  links: ['https://instagram.com/jpice'],
  officers: [
    { position: 'President', name: 'Ana Reyes' },
    { position: 'Treasurer', name: 'Ben Cruz', isPublic: false },
  ],
  actingAs: 'Ana Reyes',
};

beforeAll(async () => {
  await resetDb(db);
  world = await buildWorld(db);
  await db.documentType.create({ data: CONSTITUTION_DOCUMENT_TYPE });
  const people: Record<Person, string> = {
    owner: world.users.officer.id,
    governor: world.users.governor.id,
    admin: world.users.issc.id,
    student: world.users.outsider.id,
  };
  for (const [key, userId] of Object.entries(people) as [Person, string][]) {
    tokenOf[key] = (await tokens.sign({ userId, passwordChangeRequired: false })).token;
  }

  const accounts = createAccountRepository(db);
  const organizations = createOrganizationRepository(db);
  const audit = createAuditLogRepository(db);
  const viewers = createDocumentViewerService({ accounts });
  const documentTypes = createDocumentTypeRepository(db);
  const publicUrl = createPublicUrl('https://cdn.test');
  uploads = createUploadService({ intents: createUploadIntentRepository(db), storage });
  app = buildTestApp({
    tokens,
    uploads,
    organizations: createOrganizationService({ organizations, cache, publicUrl }),
    profiles: createProfileService({
      profiles: createProfileRepository(db),
      storage,
      audit,
      cache,
      publicUrl,
    }),
    constitutions: createConstitutionService({
      organizations,
      documents,
      documentTypes,
      viewers,
      uploads,
      queue,
      audit,
      cache,
    }),
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
    access: createAccessService({
      accounts,
      organizations,
      documents,
      projects: createProjectRepository(db),
    }),
  });
});

function call(
  method: 'get' | 'put' | 'post' | 'patch' | 'delete',
  path: string,
  who?: Person,
  body?: object,
) {
  let req = request(app)[method](`/api/v1${path}`);
  if (who) req = req.set('Authorization', `Bearer ${tokenOf[who]}`);
  return body ? req.send(body) : req;
}

function png(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 9, g: 93, b: 64 } },
  })
    .png()
    .toBuffer();
}

async function uploadKey() {
  const jpice = { id: world.orgs.jpice.id, slug: 'jpice' };
  const issued = await uploads.issueUrl(world.users.officer.id, jpice, {
    filename: 'constitution.pdf',
    contentType: 'application/pdf',
    sizeBytes: 2048,
  });
  return issued.uploadKey;
}

describe('the profile routes: who may call them', () => {
  const writes: [string, 'put' | 'delete', object?][] = [
    ['/organizations/jpice/profile', 'put', PROFILE],
    ['/organizations/jpice/profile/cover', 'delete', { actingAs: 'Ana' }],
  ];

  it('401s every profile route signed out', async () => {
    expect((await call('get', '/organizations/jpice/profile')).status).toBe(401);
    for (const [path, method, body] of writes) {
      expect((await call(method, path, undefined, body)).status).toBe(401);
    }
    const logo = await request(app)
      .put('/api/v1/organizations/jpice/profile/logo')
      .set('Content-Type', 'image/png')
      .send(await png(200, 200));
    expect(logo.status).toBe(401);
  });

  it('403s governing bodies, the ISSC admin and accounts of no organization', async () => {
    for (const who of ['governor', 'admin', 'student'] as const) {
      expect((await call('get', '/organizations/jpice/profile', who)).status).toBe(403);
      for (const [path, method, body] of writes) {
        expect((await call(method, path, who, body)).status).toBe(403);
      }
      const cover = await request(app)
        .put('/api/v1/organizations/jpice/profile/cover')
        .set('Authorization', `Bearer ${tokenOf[who]}`)
        .set('X-Orghive-Acting-As', 'Someone')
        .set('Content-Type', 'image/png')
        .send(await png(1300, 400));
      expect(cover.status).toBe(403);
    }
  });
});

describe('PUT /organizations/:slug/profile', () => {
  it('saves the profile, audits it with Acting as, and the public page hides hidden officers', async () => {
    const saved = await call('put', '/organizations/jpice/profile', 'owner', PROFILE);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      official: { acronym: 'JPICE', type: 'SBO' },
      mission: 'Shape competent civil engineers.',
      vision: null,
      officers: [
        { position: 'President', name: 'Ana Reyes', isPublic: true },
        { position: 'Treasurer', name: 'Ben Cruz', isPublic: false },
      ],
      links: [{ url: 'https://instagram.com/jpice', kind: 'instagram', label: 'Instagram' }],
    });

    const entry = await db.auditLog.findFirst({
      where: { action: 'organization_change', organizationId: world.orgs.jpice.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry?.actingAs).toBe('Ana Reyes');
    expect((entry?.metadata as { change: string }).change).toBe('profile');

    const page = await call('get', '/organizations/jpice');
    expect(page.status).toBe(200);
    expect((page.body as OrganizationDetail).officers).toEqual([{ position: 'President', name: 'Ana Reyes' }]);
    const detail = page.body as OrganizationDetail;
    expect(detail.links.map((l) => l.kind)).toEqual(['facebook', 'instagram']);
    expect(JSON.stringify(page.body)).not.toContain('Ben Cruz');
  });

  it('never changes the official name or acronym, and rejects unknown fields', async () => {
    const res = await call('put', '/organizations/jpice/profile', 'owner', {
      ...PROFILE,
      name: 'Renamed',
    });
    expect(res.status).toBe(400);
    expect((await db.organization.findUnique({ where: { id: world.orgs.jpice.id } }))?.name).not.toBe(
      'Renamed',
    );
  });

  it('400s without Acting as, a non-Facebook page link, or an http link', async () => {
    const { actingAs: _drop, ...noActor } = PROFILE;
    expect((await call('put', '/organizations/jpice/profile', 'owner', noActor)).status).toBe(400);
    expect(
      (
        await call('put', '/organizations/jpice/profile', 'owner', {
          ...PROFILE,
          facebookUrl: 'https://instagram.com/jpice',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('put', '/organizations/jpice/profile', 'owner', {
          ...PROFILE,
          links: ['http://jpice.example.org'],
        })
      ).status,
    ).toBe(400);
  });
});

describe('PUT /organizations/:slug/profile/logo and cover', () => {
  it('stores a square logo under logos/ and audits it with Acting as (percent-encoded)', async () => {
    const res = await request(app)
      .put('/api/v1/organizations/jpice/profile/logo')
      .set('Authorization', `Bearer ${tokenOf.owner}`)
      .set('X-Orghive-Acting-As', encodeURIComponent('Ma. Liên Peña'))
      .set('Content-Type', 'image/png')
      .send(await png(400, 300));
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toMatch(/^https:\/\/cdn\.test\/logos\/jpice-[0-9a-f]{12}\.webp$/);
    const entry = await db.auditLog.findFirst({
      where: { action: 'organization_change' },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry?.actingAs).toBe('Ma. Liên Peña');
    expect((entry?.metadata as { change: string }).change).toBe('logo');
  });

  it('400s an image upload without Acting as, or a cover that is too narrow', async () => {
    const noActor = await request(app)
      .put('/api/v1/organizations/jpice/profile/logo')
      .set('Authorization', `Bearer ${tokenOf.owner}`)
      .set('Content-Type', 'image/png')
      .send(await png(200, 200));
    expect(noActor.status).toBe(400);

    const narrow = await request(app)
      .put('/api/v1/organizations/jpice/profile/cover')
      .set('Authorization', `Bearer ${tokenOf.owner}`)
      .set('X-Orghive-Acting-As', 'Ana Reyes')
      .set('Content-Type', 'image/png')
      .send(await png(800, 300));
    expect(narrow.status).toBe(400);
    expect((narrow.body as { error: { message: string } }).error.message).toMatch(/cover: .*1200 pixels wide/);
  });

  it('stores a cover under logos/covers/ and removes it again', async () => {
    const res = await request(app)
      .put('/api/v1/organizations/jpice/profile/cover')
      .set('Authorization', `Bearer ${tokenOf.owner}`)
      .set('X-Orghive-Acting-As', 'Ana Reyes')
      .set('Content-Type', 'image/png')
      .send(await png(1600, 500));
    expect(res.status).toBe(200);
    expect(res.body.coverUrl).toMatch(/\/logos\/covers\/jpice-/);
    expect((await call('get', '/organizations/jpice')).body.coverUrl).toBe(res.body.coverUrl);

    const removed = await call('delete', '/organizations/jpice/profile/cover', 'owner', {
      actingAs: 'Ana Reyes',
    });
    expect(removed.status).toBe(200);
    expect(removed.body.coverUrl).toBeNull();
  });
});

describe('the Constitution & By-laws', () => {
  it('401s an upload signed out and 403s everyone but the owner', async () => {
    const body = { uploadKey: await uploadKey(), actingAs: 'Ana', amendedOn: '2026-08-01' };
    expect((await call('post', '/organizations/jpice/constitution', undefined, body)).status).toBe(
      401,
    );
    for (const who of ['governor', 'admin', 'student'] as const) {
      expect((await call('post', '/organizations/jpice/constitution', who, body)).status).toBe(403);
    }
  });

  it('is public once clean, amended with a note, and older versions stay viewable', async () => {
    expect((await call('get', '/organizations/jpice/constitution')).body).toEqual({
      constitution: null,
    });

    const first = await call('post', '/organizations/jpice/constitution', 'owner', {
      uploadKey: await uploadKey(),
      actingAs: 'Ana Reyes',
      amendedOn: '2026-08-01',
    });
    expect(first.status).toBe(201);
    const created = (first.body as ConstitutionResponse).constitution!;
    const documentId = created.documentId;
    const v1 = created.versions[0]!;
    expect(v1).toMatchObject({ version: 1, amendedOn: '2026-08-01', actingAs: 'Ana Reyes' });

    // Still being scanned: the public sees nothing yet; the owner sees it.
    expect((await call('get', '/organizations/jpice/constitution')).body.constitution).toBeNull();
    await scanClean(v1.id);

    const shown = await call('get', '/organizations/jpice/constitution');
    expect(shown.body.constitution).toMatchObject({
      documentId,
      lastAmendedOn: '2026-08-01',
      versions: [{ version: 1, actingAs: null }],
    });
    const doc = await db.document.findUnique({ where: { id: documentId } });
    expect(doc?.visibility).toBe('public');

    // An amendment needs a note, and never a date in the future.
    const noNote = await call('post', '/organizations/jpice/constitution', 'owner', {
      uploadKey: await uploadKey(),
      actingAs: 'Ana Reyes',
      amendedOn: '2026-09-15',
    });
    expect(noNote.status).toBe(400);
    const future = await call('post', '/organizations/jpice/constitution', 'owner', {
      uploadKey: await uploadKey(),
      actingAs: 'Ana Reyes',
      amendedOn: '2999-01-01',
      note: 'Future',
    });
    expect(future.status).toBe(400);

    const amended = await call('post', '/organizations/jpice/constitution', 'owner', {
      uploadKey: await uploadKey(),
      actingAs: 'Ana Reyes',
      amendedOn: '2026-09-15',
      note: 'Article III: two more officer seats.',
    });
    expect(amended.status).toBe(201);
    const v2 = (amended.body as ConstitutionResponse).constitution!.versions[0]!;
    await scanClean(v2.id);

    const after = await call('get', '/organizations/jpice/constitution');
    expect(after.body.constitution.lastAmendedOn).toBe('2026-09-15');
    expect(after.body.constitution.versions).toMatchObject([
      { version: 2, isCurrent: true, note: 'Article III: two more officer seats.' },
      { version: 1, isCurrent: false },
    ]);

    // Anyone may open the older version in the viewer.
    const old = await call('get', `/documents/${documentId}/viewer?versionId=${v1.id}`);
    expect(old.status).toBe(200);
    expect(old.body.versionId).toBe(v1.id);

    // Never private, archived, deleted or downloaded by others.
    expect(
      (await call('patch', `/documents/${documentId}/visibility`, 'owner', { visibility: 'private' }))
        .status,
    ).toBe(409);
    expect(
      (await call('delete', `/documents/${documentId}`, 'owner', { actingAs: 'Ana Reyes' })).status,
    ).toBe(409);
    expect(
      (await call('get', `/documents/${documentId}/versions/${v2.id}/download-url`, 'governor'))
        .status,
    ).toBe(403);
    expect(
      (await call('get', `/documents/${documentId}/versions/${v2.id}/download-url`, 'owner')).status,
    ).toBe(200);
    expect(queued).toContain(v2.id);
  });
});
