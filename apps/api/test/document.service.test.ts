import { describe, expect, it, vi } from 'vitest';
import { cacheKeys, memoryCache } from '#src/lib/cache';
import type { DocumentRecord } from '#src/repositories/document.repository';
import { PUBLIC_VIEWER, type DocumentViewer } from '#src/repositories/document-visibility';
import { createDocumentService } from '#src/services/document.service';

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
      createdAt: at,
    },
    ...overrides,
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
  };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  const service = createDocumentService({
    documents,
    documentTypes: {
      findById: (id: string) => Promise.resolve(id === TYPE.id ? TYPE : null),
    },
    organizations: {
      findBySlug: (slug: string) => Promise.resolve(slug === 'jpice' ? (JPICE as never) : null),
    },
    viewers: { forUser: () => Promise.resolve(VIEWER) },
    audit,
    cache,
  });
  // A cached list that every write must clear.
  cache.store.set(cacheKeys.organizationDocuments('jpice', 'abc'), '{}');
  cache.store.set(cacheKeys.organizationDocuments('psme', 'abc'), '{}');
  const jpiceListCached = () => cache.store.has(cacheKeys.organizationDocuments('jpice', 'abc'));
  return { service, documents, audit, cache, jpiceListCached };
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
  };

  it('creates a draft in the guarded organization and clears its cached lists', async () => {
    const { service, documents, jpiceListCached, cache } = setup();
    await service.create(ACTOR, JPICE, input);
    expect(documents.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'jpice', status: 'draft', createdById: 'u1' }),
    );
    expect(jpiceListCached()).toBe(false);
    expect(cache.store.has(cacheKeys.organizationDocuments('psme', 'abc'))).toBe(true);
  });

  it('400s an unknown document type', async () => {
    const { service, documents } = setup();
    await expect(
      service.create(ACTOR, JPICE, { ...input, typeId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ status: 400 });
    expect(documents.create).not.toHaveBeenCalled();
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
