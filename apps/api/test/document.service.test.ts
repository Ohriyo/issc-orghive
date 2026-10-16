import { describe, expect, it, vi } from 'vitest';
import { cacheKeys, memoryCache } from '#src/lib/cache';
import type { DocumentRecord } from '#src/repositories/document.repository';
import { PUBLIC_VIEWER, type DocumentViewer } from '#src/repositories/document-visibility';
import { createDocumentService, type DocumentServiceDeps } from '#src/services/document.service';

const JPICE = { id: 'jpice', slug: 'jpice' };
const IECEP = { id: 'iecep', slug: 'iecep' };
const TYPE = { id: '0195f3c0-0000-7000-8000-0000000000e1', slug: 'proposal', name: 'Proposal' };
const ACTOR = { userId: 'u1', ip: '10.0.0.1' };
const VIEWER: DocumentViewer = {
  kind: 'user',
  userId: 'u1',
  isAdmin: false,
  memberOrgIds: ['jpice'],
  reviewableOrgIds: [],
};

function record(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  const at = new Date('2026-10-01T00:00:00Z');
  return {
    id: 'd1',
    title: 'Proposal',
    description: null,
    academicYear: '2026-2027',
    semester: null,
    status: 'draft',
    visibility: 'members',
    tags: [],
    submittedAt: null,
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
    createdAt: new Date('2026-10-01T00:00:00Z'),
  };
}

function setup(doc: DocumentRecord | null = record()) {
  const cache = memoryCache();
  const documents = {
    findById: vi.fn((_viewer: DocumentViewer, _id: string) => Promise.resolve(doc)),
    list: vi.fn(() => Promise.resolve({ items: doc ? [doc] : [], nextCursor: null })),
    create: vi.fn(() => Promise.resolve(record())),
    update: vi.fn(() => Promise.resolve(doc)),
    setStatus: vi.fn(() => Promise.resolve(true)),
    decide: vi.fn(() => Promise.resolve(true)),
    softDelete: vi.fn(() => Promise.resolve(true)),
    addVersion: vi.fn(() =>
      Promise.resolve<{ id: string; version: number } | null>({ id: 'v2', version: 2 }),
    ),
    listVersions: vi.fn(() =>
      Promise.resolve<Awaited<ReturnType<DocumentServiceDeps['documents']['listVersions']>>>({
        organizationId: 'jpice',
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
    viewers: { forUser: () => Promise.resolve(VIEWER) },
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
    await service.list('u1', 'jpice', {});
    await service.list('u1', 'jpice', {});
    expect(documents.list).toHaveBeenCalledTimes(2);
    expect(documents.list).toHaveBeenCalledWith(VIEWER, expect.anything());
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

describe('documentService.search', () => {
  it('searches every organization through the viewer filter, 10 results by default', async () => {
    const { service, documents } = setup();
    const result = await service.search('u1', { q: 'bridge' });
    expect(documents.list).toHaveBeenCalledWith(VIEWER, { search: 'bridge', limit: 10 });
    expect(result).toMatchObject({ items: [{ id: 'd1' }], nextCursor: null });
  });

  it('searches as the public when signed out', async () => {
    const { service, documents } = setup();
    await service.search(undefined, { q: 'bridge', limit: 5 });
    expect(documents.list).toHaveBeenCalledWith(PUBLIC_VIEWER, { search: 'bridge', limit: 5 });
  });
});

describe('documentService.get', () => {
  it('returns the summary, or 404 when the viewer may not see it', async () => {
    expect(await setup().service.get('u1', 'd1')).toMatchObject({
      id: 'd1',
      visibility: 'members',
    });
    await expect(setup(null).service.get(undefined, 'd1')).rejects.toMatchObject({ status: 404 });
  });
});

describe('documentService.create', () => {
  const input = {
    typeId: TYPE.id,
    title: 'New',
    academicYear: '2026-2027',
    visibility: 'members' as const,
    tags: ['bridge'],
    uploadKey: 'uploads/jpice/k1',
  };

  it('creates the document with its uploaded file as version 1, pending, and queues it', async () => {
    const { service, documents, jpiceListCached, cache, uploads, queue, audit } = setup();
    await service.create(ACTOR, JPICE, input);
    expect(uploads.claim).toHaveBeenCalledWith('u1', JPICE, 'uploads/jpice/k1');
    expect(documents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'jpice',
        status: 'pending',
        tags: ['bridge'],
        createdById: 'u1',
        firstVersion: expect.objectContaining({
          storageKey: 'uploads/jpice/k1',
          uploadedById: 'u1',
        }) as unknown,
      }),
    );
    expect(queue.enqueueProcessing).toHaveBeenCalledWith('v1');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'upload' }));
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
    const { service, documents, queue, audit } = setup(record({ status: 'approved' }));
    const added = await service.addVersion(ACTOR, JPICE, 'd1', 'uploads/jpice/k2');
    expect(documents.addVersion).toHaveBeenCalledWith(
      VIEWER,
      'd1',
      expect.objectContaining({ storageKey: 'uploads/jpice/k1', uploadedById: 'u1' }),
    );
    expect(queue.enqueueProcessing).toHaveBeenCalledWith('v2');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'upload',
        metadata: expect.objectContaining({ version: 2 }) as unknown,
      }),
    );
    expect(added).toMatchObject({ version: 2, scanStatus: 'pending', isCurrent: false });
  });

  it('409s an archived document', async () => {
    const { service, uploads } = setup(record({ status: 'archived' }));
    await expect(service.addVersion(ACTOR, JPICE, 'd1', 'k')).rejects.toMatchObject({
      status: 409,
    });
    expect(uploads.claim).not.toHaveBeenCalled();
  });
});

describe('documentService.listVersions', () => {
  it('shows members every version, marking the current one', async () => {
    const { service } = setup();
    const { versions } = await service.listVersions('u1', 'd1');
    expect(versions.map((v) => [v.version, v.scanStatus, v.isCurrent])).toEqual([
      [2, 'pending', false],
      [1, 'clean', true],
    ]);
  });

  it('shows everyone else only clean versions', async () => {
    const { service } = setup();
    const { versions } = await service.listVersions(undefined, 'd1');
    expect(versions.map((v) => v.version)).toEqual([1]);
  });

  it('404s a document the viewer may not see', async () => {
    const { service, documents } = setup();
    documents.listVersions.mockResolvedValueOnce(null);
    await expect(service.listVersions(undefined, 'd1')).rejects.toMatchObject({ status: 404 });
  });
});

describe('documentService.downloadUrl', () => {
  it('signs a 5-minute link to a clean version, as an attachment by default', async () => {
    const { service, storage } = setup();
    const link = await service.downloadUrl(undefined, 'd1', 'v1');
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
    await expect(service.downloadUrl('u1', 'd1', 'v2')).rejects.toMatchObject({ status: 409 });
    documents.findVersion.mockResolvedValueOnce(null);
    await expect(service.downloadUrl(undefined, 'd1', 'v1')).rejects.toMatchObject({ status: 404 });
  });
});

describe('documentService previews', () => {
  it('signs the current version preview when serving, never caching a signed link', async () => {
    const doc = record();
    doc.currentVersion!.thumbnailKey = 'thumbnails/d1/v1.webp';
    const { service, cache } = setup(doc);
    const summary = await service.get(undefined, 'd1');
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
  it('edits a draft and clears the cache', async () => {
    const { service, documents, jpiceListCached } = setup();
    await service.update(ACTOR, JPICE, 'd1', { title: 'Renamed' });
    expect(documents.update).toHaveBeenCalledWith(VIEWER, 'd1', { title: 'Renamed' }, [
      'draft',
      'rejected',
    ]);
    expect(jpiceListCached()).toBe(false);
  });

  it('409s content edits once submitted, but allows changing visibility', async () => {
    const { service } = setup(record({ status: 'approved' }));
    await expect(service.update(ACTOR, JPICE, 'd1', { title: 'Sneaky' })).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      service.update(ACTOR, JPICE, 'd1', { visibility: 'public' }),
    ).resolves.toBeDefined();
  });

  it('404s a document that belongs to another organization than the guarded one', async () => {
    const { service, documents } = setup();
    await expect(service.update(ACTOR, IECEP, 'd1', { title: 'X' })).rejects.toMatchObject({
      status: 404,
    });
    expect(documents.update).not.toHaveBeenCalled();
  });

  it('409s when the status changed between the check and the write', async () => {
    const { service, documents } = setup();
    documents.update.mockResolvedValueOnce(null);
    await expect(service.update(ACTOR, JPICE, 'd1', { title: 'X' })).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('documentService.submit', () => {
  it('moves a draft with a clean file to pending', async () => {
    const { service, documents, jpiceListCached } = setup();
    await service.submit(ACTOR, JPICE, 'd1');
    expect(documents.setStatus).toHaveBeenCalledWith(VIEWER, 'd1', 'pending', {
      from: ['draft', 'rejected'],
    });
    expect(jpiceListCached()).toBe(false);
  });

  it('409s without a file, before the scan passes, or when not a draft', async () => {
    await expect(
      setup(record({ currentVersion: null })).service.submit(ACTOR, JPICE, 'd1'),
    ).rejects.toMatchObject({ status: 409 });
    const unscanned = record();
    unscanned.currentVersion!.scanStatus = 'pending';
    await expect(setup(unscanned).service.submit(ACTOR, JPICE, 'd1')).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      setup(record({ status: 'approved' })).service.submit(ACTOR, JPICE, 'd1'),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('documentService.decide', () => {
  it('records the decision, audits it and clears the cache', async () => {
    const { service, documents, audit, jpiceListCached } = setup(record({ status: 'pending' }));
    await service.decide(ACTOR, JPICE, 'd1', 'rejected', 'Missing receipts');
    expect(documents.decide).toHaveBeenCalledWith(VIEWER, 'd1', {
      decision: 'rejected',
      approverId: 'u1',
      comment: 'Missing receipts',
    });
    expect(audit.record).toHaveBeenCalledWith({
      action: 'reject',
      actorId: 'u1',
      entityType: 'document',
      entityId: 'd1',
      organizationId: 'jpice',
      metadata: { version: 1 },
      ip: '10.0.0.1',
    });
    expect(jpiceListCached()).toBe(false);
  });

  it('409s a document that is not pending, without auditing', async () => {
    const { service, audit } = setup(record({ status: 'draft' }));
    await expect(service.decide(ACTOR, JPICE, 'd1', 'approved')).rejects.toMatchObject({
      status: 409,
    });
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('documentService.remove', () => {
  it('soft-deletes, audits and clears the cache', async () => {
    const { service, documents, audit, jpiceListCached } = setup();
    await service.remove(ACTOR, JPICE, 'd1');
    expect(documents.softDelete).toHaveBeenCalledWith(VIEWER, 'd1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', entityId: 'd1', organizationId: 'jpice' }),
    );
    expect(jpiceListCached()).toBe(false);
  });

  it('404s a document the user cannot see', async () => {
    const { service, audit } = setup(null);
    await expect(service.remove(ACTOR, JPICE, 'd1')).rejects.toMatchObject({ status: 404 });
    expect(audit.record).not.toHaveBeenCalled();
  });
});
