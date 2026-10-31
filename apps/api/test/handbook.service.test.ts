import { describe, expect, it, vi } from 'vitest';
import { memoryCache } from '#src/lib/cache';
import type { AdminEditionRecord, EditionRecord } from '#src/repositories/handbook.repository';
import { createHandbookService } from '#src/services/handbook.service';

const ACTOR = { userId: 'u1', ip: '10.0.0.1' };
const ISSC = { id: 'issc-id', slug: 'issc' };
const UPLOAD = {
  uploadKey: 'uploads/x/y',
  actingAs: 'Ana Reyes',
  academicYear: '2026-2027',
};

function edition(overrides: Partial<EditionRecord> = {}): EditionRecord {
  return {
    academicYear: '2026-2027',
    isCurrent: true,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    document: {
      id: 'doc-1',
      currentVersion: {
        id: 'v1',
        scanStatus: 'clean',
        previewStatus: 'ready',
        pageCount: 40,
        thumbnailKey: 'thumbnails/doc-1/v1.webp',
        outline: null,
        pageThumbnails: true,
        createdAt: new Date('2026-08-01T00:00:00Z'),
      },
    },
    ...overrides,
  };
}

/** An edition as the ISSC account's page reads it, its current version in `previewStatus`. */
function adminEdition(previewStatus: 'pending' | 'ready' | 'failed'): AdminEditionRecord {
  return {
    academicYear: '2026-2027',
    isCurrent: true,
    document: {
      id: 'doc-1',
      status: 'available',
      currentVersionId: 'v1',
      versions: [
        {
          id: 'v1',
          version: 1,
          createdAt: new Date('2026-08-01T00:00:00Z'),
          scanStatus: 'clean',
          previewStatus,
          actingAs: 'Ana Reyes',
        },
      ],
    },
  };
}

function setup({
  current = edition(),
  readable = current ? [current] : [],
  issc = [ISSC],
}: { current?: EditionRecord | null; readable?: EditionRecord[]; issc?: (typeof ISSC)[] } = {}) {
  const handbooks = {
    listReadable: vi.fn(() => Promise.resolve(readable)),
    listForAdmin: vi.fn(() => Promise.resolve<AdminEditionRecord[]>([])),
    findAdminByYear: vi.fn(() => Promise.resolve<AdminEditionRecord | null>(null)),
    create: vi.fn(() =>
      Promise.resolve<{ documentId: string; versionId: string; isCurrent: boolean } | null>({
        documentId: 'doc-2',
        versionId: 'v9',
        isCurrent: false,
      }),
    ),
    setCurrent: vi.fn(() => Promise.resolve()),
    searchPages: vi.fn(() =>
      Promise.resolve([{ page: 12, headline: 'the \u0002dress\u0003 code' }]),
    ),
  };
  const cache = memoryCache();
  const storage = {
    presignGet: vi.fn((key: string) => Promise.resolve(`https://s.test/${key}`)),
    delete: vi.fn(() => Promise.resolve()),
  };
  const documentTypes = {
    findBySlug: vi.fn(() =>
      Promise.resolve<{ id: string; slug: string; name: string } | null>({
        id: 't-hb',
        slug: 'student-handbook',
        name: 'Student Handbook',
      }),
    ),
  };
  const documents = {
    addVersion: vi.fn(() => Promise.resolve({ id: 'v2', version: 2 })),
    resetFailedPreview: vi.fn(() => Promise.resolve(true)),
  };
  const previews = { retryPreview: vi.fn(() => Promise.resolve()) };
  const service = createHandbookService({
    handbooks,
    documents,
    documentTypes,
    organizations: { listByType: vi.fn(() => Promise.resolve(issc as never)) },
    viewers: { forUser: vi.fn(() => Promise.resolve({ kind: 'public' as const })) },
    uploads: {
      claim: vi.fn(() =>
        Promise.resolve({
          storageKey: 'uploads/x/y',
          originalFilename: 'handbook.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 10,
        }),
      ),
    },
    queue: { enqueueProcessing: vi.fn(() => Promise.resolve()) },
    previews,
    storage,
    audit: { record: vi.fn(() => Promise.resolve()) },
    cache,
  });
  return { service, handbooks, cache, storage, documentTypes, documents, previews };
}

describe('handbookService reads', () => {
  it('caches the readable editions once for every read and signs the cover on every call', async () => {
    const { service, handbooks, cache, storage } = setup();
    const first = await service.current();
    await service.current();
    await service.byYear('2026-2027');
    await service.editions();
    expect(handbooks.listReadable).toHaveBeenCalledTimes(1);
    expect(cache.store.has('org:issc:docs:handbook:editions')).toBe(true);
    expect(storage.presignGet).toHaveBeenCalledTimes(4);
    expect(first.edition).toMatchObject({
      academicYear: '2026-2027',
      pageCount: 40,
      outline: null,
      thumbnails: true,
      coverUrl: 'https://s.test/thumbnails/doc-1/v1.webp',
    });
  });

  it('falls back to the most recently uploaded edition when none marked current is readable', async () => {
    const older = edition({ academicYear: '2025-2026', isCurrent: false, createdAt: new Date('2025-08-01') });
    const newer = edition({ academicYear: '2027-2028', isCurrent: false, createdAt: new Date('2026-09-01') });
    const { service } = setup({ readable: [newer, older] });
    expect((await service.current()).edition).toMatchObject({ academicYear: '2027-2028', isCurrent: true });
    // Readers see one current edition everywhere: the list and the year agree.
    expect((await service.editions()).editions.map((e) => [e.academicYear, e.isCurrent])).toEqual([
      ['2027-2028', true],
      ['2025-2026', false],
    ]);
    expect((await service.byYear('2025-2026')).edition).toMatchObject({ isCurrent: false });
  });

  it('answers a year with that edition, and 404s a year without a readable one', async () => {
    const past = edition({ academicYear: '2025-2026', isCurrent: false, createdAt: new Date('2025-08-01') });
    const { service } = setup({ readable: [edition(), past] });
    expect((await service.byYear('2025-2026')).edition).toMatchObject({
      academicYear: '2025-2026',
      isCurrent: false,
    });
    await expect(service.byYear('2030-2031')).rejects.toMatchObject({ status: 404 });
  });

  it('answers no edition before any is readable', async () => {
    const { service } = setup({ current: null });
    expect(await service.current()).toEqual({ edition: null });
    expect(await service.editions()).toEqual({ editions: [] });
  });

  it('shows no cover or page count before the preview is rendered', async () => {
    const pending = edition();
    pending.document.currentVersion!.previewStatus = 'pending';
    const { service } = setup({ current: pending });
    expect((await service.current()).edition).toMatchObject({ coverUrl: null, pageCount: null });
  });

  it('gives the site search the current edition pages, or null', async () => {
    const { service } = setup();
    expect(await service.siteMatches('dress', 3)).toEqual({
      academicYear: '2026-2027',
      matches: [{ page: 12, snippet: [{ text: 'the ', match: false }, { text: 'dress', match: true }, { text: ' code', match: false }] }],
    });
    expect(await setup({ current: null }).service.siteMatches('dress', 3)).toBeNull();
  });

  it('404s a search in a year without a readable edition', async () => {
    await expect(setup({ current: null }).service.search('2030-2031', 'dress')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('fails loudly when the ISSC organization is missing', async () => {
    await expect(setup({ issc: [] }).service.current()).rejects.toThrow(/ISSC organization/);
  });
});

describe('handbookService.upload', () => {
  it('409s when another upload took the year first', async () => {
    const { service, handbooks } = setup();
    handbooks.create.mockResolvedValueOnce(null);
    await expect(service.upload(ACTOR, UPLOAD)).rejects.toMatchObject({ status: 409 });
  });

  it('fails loudly when the document type is missing', async () => {
    const { service, documentTypes } = setup();
    documentTypes.findBySlug.mockResolvedValueOnce(null);
    await expect(service.upload(ACTOR, UPLOAD)).rejects.toThrow(/run the migrations/);
  });
});

describe('handbookService.retryPreview', () => {
  it('queues the current version again after its pages failed, and clears the caches', async () => {
    const { service, handbooks, documents, previews, cache } = setup();
    await service.current();
    handbooks.findAdminByYear.mockResolvedValueOnce(adminEdition('failed'));
    await service.retryPreview('2026-2027');
    expect(documents.resetFailedPreview).toHaveBeenCalledWith('v1');
    expect(previews.retryPreview).toHaveBeenCalledWith('v1');
    expect(cache.store.has('org:issc:docs:handbook:editions')).toBe(false);
  });

  it('queues nothing when a concurrent retry already reset it', async () => {
    const { service, handbooks, documents, previews } = setup();
    handbooks.findAdminByYear.mockResolvedValueOnce(adminEdition('failed'));
    documents.resetFailedPreview.mockResolvedValueOnce(false);
    await service.retryPreview('2026-2027');
    expect(previews.retryPreview).not.toHaveBeenCalled();
  });

  it('409s pages that did not fail and 404s a year without an edition', async () => {
    const { service, handbooks, previews } = setup();
    handbooks.findAdminByYear.mockResolvedValueOnce(adminEdition('ready'));
    await expect(service.retryPreview('2026-2027')).rejects.toMatchObject({ status: 409 });
    await expect(service.retryPreview('2030-2031')).rejects.toMatchObject({ status: 404 });
    expect(previews.retryPreview).not.toHaveBeenCalled();
  });
});
