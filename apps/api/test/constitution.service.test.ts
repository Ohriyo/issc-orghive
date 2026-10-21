import { describe, expect, it, vi } from 'vitest';
import { memoryCache } from '#src/lib/cache';
import type { VersionRecord } from '#src/repositories/document.repository';
import type { DocumentViewer } from '#src/repositories/document-visibility';
import {
  constitutionCacheKey,
  createConstitutionService,
  isConstitutionType,
} from '#src/services/constitution.service';

const ACTOR = { userId: 'u1', ip: '10.0.0.1' };
const JPICE = { id: 'jpice-id', slug: 'jpice' };
const OWNER: DocumentViewer = {
  kind: 'account',
  userId: 'u1',
  organizationId: 'jpice-id',
  organizationType: 'SBO',
};
const TYPE = { id: 't-con', slug: 'constitution-by-laws', name: 'Constitution & By-laws' };
const FILE = {
  storageKey: 'uploads/jpice/k1',
  originalFilename: 'constitution.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
};

function version(id: string, n: number, overrides: Partial<VersionRecord> = {}): VersionRecord {
  return {
    id,
    version: n,
    originalFilename: `${id}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 10,
    scanStatus: 'clean',
    storageKey: `files/${id}`,
    actingAs: 'Ana Reyes',
    previewStatus: 'ready',
    amendedOn: new Date(`2026-0${n + 7}-01T00:00:00Z`),
    note: n > 1 ? 'Article III amended' : null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

function setup(constitutionDocumentId: string | null = 'doc-1') {
  const organizations = {
    findBySlug: vi.fn((slug: string) =>
      Promise.resolve(slug === 'jpice' ? ({ ...JPICE, constitutionDocumentId } as never) : null),
    ),
  };
  const documents = {
    listVersions: vi.fn(() =>
      Promise.resolve({
        organizationId: 'jpice-id',
        visibility: 'public' as const,
        currentVersionId: 'v2',
        versions: [version('v2', 2), version('v1', 1)],
      }),
    ),
    createConstitution: vi.fn(() =>
      Promise.resolve({ id: 'doc-1', currentVersion: { id: 'v1' } } as never),
    ),
    addVersion: vi.fn(() => Promise.resolve({ id: 'v3', version: 3 })),
  };
  const uploads = { claim: vi.fn(() => Promise.resolve(FILE)) };
  const queue = { enqueueProcessing: vi.fn(() => Promise.resolve()) };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  const cache = memoryCache();
  const viewers = { forUser: vi.fn(() => Promise.resolve(OWNER)) };
  const service = createConstitutionService({
    organizations,
    documents,
    documentTypes: { findBySlug: () => Promise.resolve(TYPE) },
    viewers,
    uploads,
    queue,
    audit,
    cache,
    now: () => new Date('2026-10-21T04:00:00Z'),
  });
  return { service, documents, uploads, queue, audit, cache };
}

describe('isConstitutionType', () => {
  it('is true for the Constitution & By-laws type only', () => {
    expect(isConstitutionType(TYPE)).toBe(true);
    expect(isConstitutionType({ slug: 'activity-proposal' })).toBe(false);
  });
});

describe('constitutionService.get', () => {
  it('lists versions newest first with the current date, and caches the public read', async () => {
    const { service, documents, cache } = setup();
    const result = await service.get({}, 'jpice');
    expect(result.constitution).toMatchObject({
      documentId: 'doc-1',
      lastAmendedOn: '2026-09-01',
      versions: [
        { id: 'v2', isCurrent: true, note: 'Article III amended', actingAs: null },
        { id: 'v1', isCurrent: false, amendedOn: '2026-08-01' },
      ],
    });
    await service.get({}, 'jpice');
    expect(documents.listVersions).toHaveBeenCalledTimes(1);
    expect(cache.store.has(constitutionCacheKey('jpice'))).toBe(true);
  });

  it('shows the owner who uploaded each version, uncached', async () => {
    const { service, cache } = setup();
    const result = await service.get({ userId: 'u1' }, 'jpice');
    expect(result.constitution?.versions[0]?.actingAs).toBe('Ana Reyes');
    expect(cache.store.size).toBe(0);
  });

  it('is null without a constitution, or while version 1 is not visible yet', async () => {
    expect(await setup(null).service.get({}, 'jpice')).toEqual({ constitution: null });
    const hidden = setup();
    hidden.documents.listVersions.mockResolvedValueOnce(null as never);
    expect(await hidden.service.get({}, 'jpice')).toEqual({ constitution: null });
  });

  it('404s an unknown organization', async () => {
    await expect(setup().service.get({}, 'nope')).rejects.toMatchObject({ status: 404 });
  });
});

describe('constitutionService.upload', () => {
  const base = { uploadKey: 'uploads/jpice/k1', actingAs: 'Ana Reyes', amendedOn: '2026-08-01' };

  it('creates the first version as a public, scanning document and queues the scan', async () => {
    const { service, documents, queue, audit } = setup(null);
    await service.upload(ACTOR, JPICE, base);
    expect(documents.createConstitution).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'jpice-id',
        typeId: 't-con',
        visibility: 'public',
        status: 'scanning',
        academicYear: '2026-2027',
        firstVersion: expect.objectContaining({
          actingAs: 'Ana Reyes',
          amendedOn: new Date('2026-08-01T00:00:00Z'),
          note: null,
        }) as unknown,
      }),
    );
    expect(queue.enqueueProcessing).toHaveBeenCalledWith('v1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'upload',
        actingAs: 'Ana Reyes',
        metadata: { constitution: true, version: 1, amendedOn: '2026-08-01' },
      }),
    );
  });

  it('409s when another first upload won the race', async () => {
    const { service, documents } = setup(null);
    documents.createConstitution.mockResolvedValueOnce(null as never);
    await expect(service.upload(ACTOR, JPICE, base)).rejects.toMatchObject({ status: 409 });
  });

  it('adds an amendment as a new version with its note and date', async () => {
    const { service, documents, queue } = setup();
    await service.upload(ACTOR, JPICE, { ...base, amendedOn: '2026-10-01', note: 'Art. V' });
    expect(documents.addVersion).toHaveBeenCalledWith(
      OWNER,
      'doc-1',
      expect.objectContaining({ note: 'Art. V', amendedOn: new Date('2026-10-01T00:00:00Z') }),
    );
    expect(queue.enqueueProcessing).toHaveBeenCalledWith('v3');
  });

  it('400s an amendment without a note, or any date after today in Manila', async () => {
    const { service, uploads } = setup();
    await expect(service.upload(ACTOR, JPICE, base)).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/^note: /) as unknown,
    });
    await expect(
      service.upload(ACTOR, JPICE, { ...base, amendedOn: '2026-10-22', note: 'x' }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^amendedOn: /) as unknown });
    expect(uploads.claim).not.toHaveBeenCalled();
  });

  it('404s when the amended document is gone', async () => {
    const { service, documents } = setup();
    documents.addVersion.mockResolvedValueOnce(null as never);
    await expect(
      service.upload(ACTOR, JPICE, { ...base, note: 'Art. V' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
