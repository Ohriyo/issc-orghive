import { describe, expect, it, vi } from 'vitest';
import { cacheKeys, memoryCache } from '#src/lib/cache';
import type { DocumentRecord } from '#src/repositories/document.repository';
import { PUBLIC_VIEWER, type DocumentViewer } from '#src/repositories/document-visibility';
import { createDocumentService, type DocumentServiceDeps } from '#src/services/document.service';

const JPICE = { id: 'jpice', slug: 'jpice' };
const IECEP = { id: 'iecep', slug: 'iecep' };
const TYPE = { id: '0195f3c0-0000-7000-8000-0000000000e1', slug: 'proposal', name: 'Proposal' };
const ACTOR = { userId: 'u1', ip: '10.0.0.1' };
const READER = { userId: 'u1', ip: '10.0.0.1' };
const SIGNED_OUT = {};
const VIEWER: DocumentViewer = {
  kind: 'account',
  userId: 'u1',
  organizationId: 'jpice',
  organizationType: 'SBO',
};

function record(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  const at = new Date('2026-10-01T00:00:00Z');
  return {
    id: 'd1',
    title: 'Proposal',
    description: null,
    academicYear: '2026-2027',
    semester: null,
    status: 'available',
    visibility: 'governing',
    tags: [],
    createdAt: at,
    updatedAt: at,
    organization: { id: 'jpice', slug: 'jpice', acronym: 'JPICE', name: 'JPICE', type: 'SBO' },
    type: TYPE,
    currentVersion: {
      id: 'v1',
      version: 1,
      originalFilename: 'p.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      scanStatus: 'clean',
      thumbnailKey: null,
      createdAt: at,
    },
    ...overrides,
  };
}

function version(id: string, n: number, scanStatus: 'pending' | 'clean' | 'infected') {
  return {
    id,
    version: n,
    originalFilename: `${id}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 10,
    scanStatus,
    storageKey: `uploads/${id}`,
    actingAs: 'Juan Dela Cruz',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    document: { organizationId: 'jpice', visibility: 'private' as const },
  };
}

function setup(doc: DocumentRecord | null = record(), viewer: DocumentViewer = VIEWER) {
  const cache = memoryCache();
  const documents = {
    findById: vi.fn((_viewer: DocumentViewer, _id: string) => Promise.resolve(doc)),
    list: vi.fn(() => Promise.resolve({ items: doc ? [doc] : [], nextCursor: null })),
    create: vi.fn(() => Promise.resolve(record({ status: 'scanning' }))),
    update: vi.fn(() => Promise.resolve(doc)),
    setVisibility: vi.fn(() => Promise.resolve(doc && { ...doc, visibility: 'public' as const })),
    softDelete: vi.fn(() => Promise.resolve(true)),
    archive: vi.fn(() => Promise.resolve(true)),
    restore: vi.fn(() => Promise.resolve(true)),
    addVersion: vi.fn(() =>
      Promise.resolve<{ id: string; version: number } | null>({ id: 'v2', version: 2 }),
    ),
    listVersions: vi.fn(() =>
      Promise.resolve<Awaited<ReturnType<DocumentServiceDeps['documents']['listVersions']>>>({
        organizationId: 'jpice',
        visibility: 'private',
        currentVersionId: 'v1',
        versions: [version('v2', 2, 'pending'), version('v1', 1, 'clean')],
      }),
    ),
    findVersion: vi.fn(() =>
      Promise.resolve<ReturnType<typeof version> | null>(version('v1', 1, 'clean')),
    ),
  };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  const uploads = {
    claim: vi.fn(() =>
      Promise.resolve({
        storageKey: 'uploads/jpice/k1',
        originalFilename: 'p.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
      }),
    ),
  };
  const queue = { enqueueProcessing: vi.fn(() => Promise.resolve()) };
  const storage = {
    presignGet: vi.fn((key: string) => Promise.resolve(`https://storage.test/${key}?signed`)),
  };
  const service = createDocumentService({
    documents,
    documentTypes: {
      findById: (id: string) => Promise.resolve(id === TYPE.id ? TYPE : null),
      list: vi.fn(() => Promise.resolve([TYPE])),
    },
    organizations: {
      findBySlug: (slug: string) => Promise.resolve(slug === 'jpice' ? (JPICE as never) : null),
    },
    viewers: { forUser: () => Promise.resolve(viewer) },
    uploads,
    queue,
    storage,
    audit,
    cache,
    now: () => new Date('2026-10-16T00:00:00Z'),
  });
  // A cached list that every write must clear.
  cache.store.set(cacheKeys.organizationDocuments('jpice', 'abc'), '{}');
  cache.store.set(cacheKeys.organizationDocuments('psme', 'abc'), '{}');
  const jpiceListCached = () => cache.store.has(cacheKeys.organizationDocuments('jpice', 'abc'));
  return { service, documents, audit, cache, jpiceListCached, uploads, queue, storage };
}

describe('documentService.list', () => {
  it('caches signed-out lists and reuses them', async () => {
    const { service, documents } = setup();
    await service.list(undefined, 'jpice', { limit: 10 });
    await service.list(undefined, 'jpice', { limit: 10 });
    expect(documents.list).toHaveBeenCalledTimes(1);
    expect(documents.list).toHaveBeenCalledWith(
      PUBLIC_VIEWER,
      expect.objectContaining({ organizationId: 'jpice' }),
    );
  });

  it('never caches signed-in lists and filters them for the user', async () => {
    const { service, documents } = setup();
    await service.list('u1', 'jpice', { visibility: 'private', status: 'available' });
    await service.list('u1', 'jpice', {});
    expect(documents.list).toHaveBeenCalledTimes(2);
    expect(documents.list).toHaveBeenCalledWith(
      VIEWER,
      expect.objectContaining({ visibility: 'private', status: 'available' }),
    );
  });

  it('404s an unknown organization', async () => {
    await expect(setup().service.list(undefined, 'nope', {})).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('documentService.listTypes', () => {
  it('lists document types and caches them', async () => {
    const { service, cache } = setup();
    expect(await service.listTypes()).toEqual({ types: [TYPE] });
    expect(cache.store.has('document-types:list')).toBe(true);
  });
});

describe('documentService.get', () => {
  it('returns the summary, or 404 when the viewer may not see it', async () => {
    expect(await setup().service.get(READER, 'd1')).toMatchObject({
      id: 'd1',
      visibility: 'governing',
    });
    await expect(setup(null).service.get(SIGNED_OUT, 'd1')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('writes no audit entry for a read: nobody sees a document past its visibility', async () => {
    const { service, audit } = setup();
    await service.get(READER, 'd1');
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('documentService.create', () => {
  const input = {
    typeId: TYPE.id,
    title: 'New',
    academicYear: '2026-2027',
    visibility: 'governing' as const,
    tags: ['bridge'],
    uploadKey: 'uploads/jpice/k1',
    actingAs: 'Juan Dela Cruz',
  };

  it('creates a scanning document with its file as version 1, and queues the scan', async () => {
    const { service, documents, jpiceListCached, cache, uploads, queue, audit } = setup();
    const created = await service.create(ACTOR, JPICE, input);
    expect(uploads.claim).toHaveBeenCalledWith('u1', JPICE, 'uploads/jpice/k1');
    expect(documents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'jpice',
        status: 'scanning',
        visibility: 'governing',
        tags: ['bridge'],
        createdById: 'u1',
        firstVersion: expect.objectContaining({
          storageKey: 'uploads/jpice/k1',
          uploadedById: 'u1',
          actingAs: 'Juan Dela Cruz',
        }) as unknown,
      }),
    );
    expect(created.status).toBe('scanning');
    expect(queue.enqueueProcessing).toHaveBeenCalledWith('v1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'upload', actingAs: 'Juan Dela Cruz' }),
    );
    expect(jpiceListCached()).toBe(false);
    expect(cache.store.has(cacheKeys.organizationDocuments('psme', 'abc'))).toBe(true);
  });

  it('400s an unknown document type without claiming the upload', async () => {
    const { service, documents, uploads } = setup();
    await expect(
      service.create(ACTOR, JPICE, { ...input, typeId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ status: 400 });
    expect(uploads.claim).not.toHaveBeenCalled();
    expect(documents.create).not.toHaveBeenCalled();
  });
});

describe('documentService.addVersion', () => {
  it('claims the upload, adds the next version and queues it', async () => {
    const { service, documents, queue, audit } = setup();
    const added = await service.addVersion(ACTOR, JPICE, 'd1', {
      uploadKey: 'uploads/jpice/k2',
      actingAs: 'Maria Santos',
    });
    expect(documents.addVersion).toHaveBeenCalledWith(
      VIEWER,
      'd1',
      expect.objectContaining({
        storageKey: 'uploads/jpice/k1',
        uploadedById: 'u1',
        actingAs: 'Maria Santos',
      }),
    );
    expect(queue.enqueueProcessing).toHaveBeenCalledWith('v2');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'upload',
        actingAs: 'Maria Santos',
        metadata: expect.objectContaining({ version: 2 }) as unknown,
      }),
    );
    expect(added).toMatchObject({
      version: 2,
      scanStatus: 'pending',
      isCurrent: false,
      actingAs: 'Maria Santos',
    });
  });

  it('409s an archived document', async () => {
    const { service, uploads } = setup(record({ status: 'archived' }));
    await expect(
      service.addVersion(ACTOR, JPICE, 'd1', { uploadKey: 'k', actingAs: 'Juan' }),
    ).rejects.toMatchObject({
      status: 409,
    });
    expect(uploads.claim).not.toHaveBeenCalled();
  });
});

describe('documentService.listVersions', () => {
  it('returns the versions the repository allows, marking the current one', async () => {
    const { service, documents } = setup();
    const { versions } = await service.listVersions(READER, 'd1');
    expect(documents.listVersions).toHaveBeenCalledWith(VIEWER, 'd1');
    expect(versions.map((v) => [v.version, v.scanStatus, v.isCurrent])).toEqual([
      [2, 'pending', false],
      [1, 'clean', true],
    ]);
  });

  it('shows who acted for the account to the owning organization only', async () => {
    const own = await setup().service.listVersions(READER, 'd1');
    expect(own.versions.map((v) => v.actingAs)).toEqual(['Juan Dela Cruz', 'Juan Dela Cruz']);
    const governing: DocumentViewer = {
      kind: 'account',
      userId: 'u2',
      organizationId: 'csc-cea',
      organizationType: 'CSC',
    };
    const csc = await setup(record(), governing).service.listVersions(READER, 'd1');
    expect(csc.versions.map((v) => v.actingAs)).toEqual([null, null]);
  });

  it('404s a document the viewer may not see', async () => {
    const { service, documents } = setup();
    documents.listVersions.mockResolvedValueOnce(null);
    await expect(service.listVersions(SIGNED_OUT, 'd1')).rejects.toMatchObject({ status: 404 });
  });
});

describe('documentService.downloadUrl', () => {
  it('signs a 5-minute link to a clean version, as an attachment by default', async () => {
    const { service, storage } = setup();
    const link = await service.downloadUrl(SIGNED_OUT, 'd1', 'v1');
    expect(storage.presignGet).toHaveBeenCalledWith(
      'uploads/v1',
      { filename: 'v1.pdf', contentType: 'application/pdf', disposition: 'attachment' },
      300,
    );
    expect(link).toEqual({
      url: 'https://storage.test/uploads/v1?signed',
      expiresAt: '2026-10-16T00:05:00.000Z',
    });
  });

  it('409s a file that has not passed the scan, 404s an invisible one', async () => {
    const { service, documents } = setup();
    documents.findVersion.mockResolvedValueOnce(version('v2', 2, 'infected'));
    await expect(service.downloadUrl(READER, 'd1', 'v2')).rejects.toMatchObject({ status: 409 });
    documents.findVersion.mockResolvedValueOnce(null);
    await expect(service.downloadUrl(SIGNED_OUT, 'd1', 'v1')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('documentService previews', () => {
  it('signs the current version preview when serving, never caching a signed link', async () => {
    const doc = record({ visibility: 'public' });
    doc.currentVersion!.thumbnailKey = 'thumbnails/d1/v1.webp';
    const { service, cache } = setup(doc);
    const summary = await service.get(SIGNED_OUT, 'd1');
    expect(summary.currentVersion?.thumbnailUrl).toBe(
      'https://storage.test/thumbnails/d1/v1.webp?signed',
    );
    await service.list(undefined, 'jpice', {});
    const cached = [...cache.store.values()].find((v) => v.includes('thumbnails/d1'));
    expect(cached).toContain('"thumbnailKey":"thumbnails/d1/v1.webp"');
    expect(cached).not.toContain('?signed');
  });
});

describe('documentService.update', () => {
  it('edits an available document (nothing to re-approve) and clears the cache', async () => {
    const { service, documents, jpiceListCached } = setup();
    await service.update(ACTOR, JPICE, 'd1', { title: 'Renamed' });
    expect(documents.update).toHaveBeenCalledWith(VIEWER, 'd1', { title: 'Renamed' });
    expect(jpiceListCached()).toBe(false);
  });

  it('409s an archived document', async () => {
    const { service, documents } = setup(record({ status: 'archived' }));
    await expect(service.update(ACTOR, JPICE, 'd1', { title: 'Late' })).rejects.toMatchObject({
      status: 409,
    });
    expect(documents.update).not.toHaveBeenCalled();
  });

  it('404s a document that belongs to another organization than the guarded one', async () => {
    const { service, documents } = setup();
    await expect(service.update(ACTOR, IECEP, 'd1', { title: 'X' })).rejects.toMatchObject({
      status: 404,
    });
    expect(documents.update).not.toHaveBeenCalled();
  });

  it('409s when the document was archived between the check and the write', async () => {
    const { service, documents } = setup();
    documents.update.mockResolvedValueOnce(null);
    await expect(service.update(ACTOR, JPICE, 'd1', { title: 'X' })).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('documentService.setVisibility', () => {
  it('changes who can see it, audits from and to, and clears the cache', async () => {
    const { service, documents, audit, jpiceListCached } = setup();
    const updated = await service.setVisibility(ACTOR, JPICE, 'd1', 'public');
    expect(documents.setVisibility).toHaveBeenCalledWith(VIEWER, 'd1', 'public');
    expect(updated.visibility).toBe('public');
    expect(audit.record).toHaveBeenCalledWith({
      action: 'visibility_change',
      actorId: 'u1',
      entityType: 'document',
      entityId: 'd1',
      organizationId: 'jpice',
      metadata: { from: 'governing', to: 'public' },
      ip: '10.0.0.1',
    });
    expect(jpiceListCached()).toBe(false);
  });

  it('works in any state, archived included', async () => {
    const { service, documents } = setup(record({ status: 'archived' }));
    await service.setVisibility(ACTOR, JPICE, 'd1', 'public');
    expect(documents.setVisibility).toHaveBeenCalled();
  });

  it('writes and audits nothing when the visibility is unchanged', async () => {
    const { service, documents, audit, jpiceListCached } = setup();
    expect((await service.setVisibility(ACTOR, JPICE, 'd1', 'governing')).visibility).toBe(
      'governing',
    );
    expect(documents.setVisibility).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(jpiceListCached()).toBe(true);
  });

  it('404s a document of another organization, or one the officer cannot see', async () => {
    await expect(setup().service.setVisibility(ACTOR, IECEP, 'd1', 'public')).rejects.toMatchObject(
      { status: 404 },
    );
    await expect(
      setup(null).service.setVisibility(ACTOR, JPICE, 'd1', 'public'),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('documentService.remove', () => {
  it('soft-deletes, audits and clears the cache', async () => {
    const { service, documents, audit, jpiceListCached } = setup();
    await service.remove(ACTOR, JPICE, 'd1', 'Juan Dela Cruz');
    expect(documents.softDelete).toHaveBeenCalledWith(VIEWER, 'd1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delete',
        entityId: 'd1',
        organizationId: 'jpice',
        actingAs: 'Juan Dela Cruz',
      }),
    );
    expect(jpiceListCached()).toBe(false);
  });

  it('404s a document the user cannot see', async () => {
    const { service, audit } = setup(null);
    await expect(service.remove(ACTOR, JPICE, 'd1', 'Juan')).rejects.toMatchObject({
      status: 404,
    });
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('documentService.archive', () => {
  it('archives an available document, audits it and clears the cache', async () => {
    const { service, documents, audit, jpiceListCached } = setup();
    await service.archive(ACTOR, JPICE, 'd1', 'Juan Dela Cruz');
    expect(documents.archive).toHaveBeenCalledWith(VIEWER, 'd1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'archive', entityId: 'd1', actingAs: 'Juan Dela Cruz' }),
    );
    expect(jpiceListCached()).toBe(false);
  });

  it('409s a scanning, quarantined or archived document without writing', async () => {
    for (const status of ['scanning', 'quarantined', 'archived'] as const) {
      const { service, documents, audit } = setup(record({ status }));
      await expect(service.archive(ACTOR, JPICE, 'd1', 'Juan')).rejects.toMatchObject({
        status: 409,
      });
      expect(documents.archive).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    }
  });

  it('404s a document of another organization', async () => {
    const { service } = setup();
    await expect(service.archive(ACTOR, IECEP, 'd1', 'Juan')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('documentService.restore', () => {
  it('restores an archived document to available and audits it', async () => {
    const doc = record({ status: 'archived' });
    const { service, documents, audit, jpiceListCached } = setup(doc);
    documents.findById.mockResolvedValueOnce(doc).mockResolvedValueOnce(record());
    const restored = await service.restore(ACTOR, JPICE, 'd1');
    expect(documents.restore).toHaveBeenCalledWith(VIEWER, 'd1');
    expect(restored.status).toBe('available');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'restore', entityId: 'd1' }),
    );
    expect(jpiceListCached()).toBe(false);
  });

  it('409s a document that is not archived, or changed before the write', async () => {
    await expect(setup().service.restore(ACTOR, JPICE, 'd1')).rejects.toMatchObject({
      status: 409,
    });
    const raced = setup(record({ status: 'archived' }));
    raced.documents.restore.mockResolvedValue(false);
    await expect(raced.service.restore(ACTOR, JPICE, 'd1')).rejects.toMatchObject({
      status: 409,
    });
    expect(raced.audit.record).not.toHaveBeenCalled();
  });
});
