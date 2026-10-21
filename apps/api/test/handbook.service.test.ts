import { describe, expect, it, vi } from 'vitest';
import { memoryCache } from '#src/lib/cache';
import type { EditionRecord } from '#src/repositories/handbook.repository';
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

function setup({
  current = edition(),
  issc = [ISSC],
}: { current?: EditionRecord | null; issc?: (typeof ISSC)[] } = {}) {
  const handbooks = {
    findCurrent: vi.fn(() => Promise.resolve(current)),
    findByYear: vi.fn(() => Promise.resolve(current)),
    listReadable: vi.fn(() => Promise.resolve(current ? [current] : [])),
    listForAdmin: vi.fn(() => Promise.resolve([])),
    findAdminByYear: vi.fn(() => Promise.resolve(null)),
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
  const service = createHandbookService({
    handbooks,
    documents: { addVersion: vi.fn(() => Promise.resolve({ id: 'v2', version: 2 })) },
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
    storage,
    audit: { record: vi.fn(() => Promise.resolve()) },
    cache,
  });
  return { service, handbooks, cache, storage, documentTypes };
}

describe('handbookService reads', () => {
  it('caches the current edition by key and signs its cover on every call', async () => {
    const { service, handbooks, cache, storage } = setup();
    const first = await service.current();
    await service.current();
    expect(handbooks.findCurrent).toHaveBeenCalledTimes(1);
    expect(cache.store.has('org:issc:docs:handbook:current')).toBe(true);
    expect(storage.presignGet).toHaveBeenCalledTimes(2);
    expect(first.edition).toMatchObject({
      academicYear: '2026-2027',
      pageCount: 40,
      outline: null,
      thumbnails: true,
      coverUrl: 'https://s.test/thumbnails/doc-1/v1.webp',
    });
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
