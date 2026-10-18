import { describe, expect, it, vi } from 'vitest';
import { SNIPPET_MATCH_END, SNIPPET_MATCH_START } from '@orghive/shared';
import { cacheKeys, invalidateDocuments, memoryCache, type Cache } from '#src/lib/cache';
import type {
  DocumentSearchFilters,
  DocumentSearchMatch,
} from '#src/repositories/document.repository';
import { PUBLIC_VIEWER, type DocumentViewer } from '#src/repositories/document-visibility';
import { createSearchService } from '#src/services/search.service';

const VIEWER: DocumentViewer = {
  kind: 'user',
  userId: 'u1',
  isAdmin: false,
  memberOrgIds: ['jpice'],
  officerOrgIds: [],
};

function match(overrides: Partial<DocumentSearchMatch> = {}): DocumentSearchMatch {
  const at = new Date('2026-10-01T00:00:00Z');
  return {
    id: 'd1',
    title: 'Water survey',
    description: null,
    academicYear: '2026-2027',
    semester: 'first',
    status: 'available',
    visibility: 'public',
    tags: [],
    createdAt: at,
    updatedAt: at,
    organization: { id: 'jpice', slug: 'jpice', acronym: 'JPICE', name: 'JPICE', type: 'SBO' },
    type: { id: 't1', slug: 'accomplishment-report', name: 'Accomplishment report' },
    currentVersion: {
      id: 'v1',
      version: 1,
      originalFilename: 'w.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      scanStatus: 'clean',
      thumbnailKey: 'thumbs/v1.webp',
      createdAt: at,
    },
    headline: `lifted with a ${SNIPPET_MATCH_START}ram${SNIPPET_MATCH_END} pump`,
    ...overrides,
  };
}

function setup({
  items = [match()],
  hasMore = false,
  cache = memoryCache(),
}: { items?: DocumentSearchMatch[]; hasMore?: boolean; cache?: Cache } = {}) {
  const documents = {
    search: vi.fn((_viewer: DocumentViewer, _filters: DocumentSearchFilters) =>
      Promise.resolve({ items, hasMore }),
    ),
  };
  const viewers = { forUser: vi.fn(() => Promise.resolve(VIEWER)) };
  let signed = 0;
  const storage = {
    presignGet: vi.fn((key: string) => Promise.resolve(`https://s.test/${key}?sig=${++signed}`)),
  };
  const service = createSearchService({ documents, viewers, storage, cache });
  return { service, documents, viewers, storage, cache };
}

describe('searchService.search', () => {
  it('searches as the public when signed out, with slugs passed as filters', async () => {
    const { service, documents } = setup();
    await service.search(undefined, {
      q: 'ram pump',
      college: 'cea',
      org: 'jpice',
      type: 'accomplishment-report',
      year: '2026-2027',
    });
    expect(documents.search).toHaveBeenCalledWith(PUBLIC_VIEWER, {
      query: 'ram pump',
      collegeSlug: 'cea',
      organizationSlug: 'jpice',
      typeSlug: 'accomplishment-report',
      academicYear: '2026-2027',
      offset: 0,
      limit: 20,
    });
  });

  it('searches as the signed-in viewer', async () => {
    const { service, documents, viewers } = setup();
    await service.search('u1', { q: 'pump' });
    expect(viewers.forUser).toHaveBeenCalledWith('u1');
    expect(documents.search).toHaveBeenCalledWith(VIEWER, expect.anything());
  });

  it('returns the snippet as plain-text parts and signs the preview', async () => {
    const { service } = setup();
    const result = await service.search(undefined, { q: 'ram' });
    expect(result).toMatchObject({ query: 'ram', page: 1, nextPage: null });
    expect(result.items[0]!.snippet).toEqual([
      { text: 'lifted with a ', match: false },
      { text: 'ram', match: true },
      { text: ' pump', match: false },
    ]);
    expect(result.items[0]!.document.currentVersion?.thumbnailUrl).toMatch(
      /^https:\/\/s\.test\/thumbs\/v1\.webp/,
    );
  });

  it('gives a null snippet when there is no text to show', async () => {
    const { service } = setup({ items: [match({ headline: null })] });
    expect((await service.search(undefined, { q: 'water' })).items[0]!.snippet).toBeNull();
  });

  it('shows the description, not the file’s opening words, when only the title matched', async () => {
    const { service } = setup({
      items: [
        match({
          headline: 'Republic of the Philippines NORTHWEST SAMAR STATE UNIVERSITY',
          description: 'Survey of household water sources.',
        }),
      ],
    });
    expect((await service.search(undefined, { q: 'survey' })).items[0]!.snippet).toEqual([
      { text: 'Survey of household water sources.', match: false },
    ]);
  });

  it('pages by offset and stops at the ranked result limit', async () => {
    const { service, documents } = setup({ hasMore: true });
    expect((await service.search(undefined, { q: 'pump', page: 3, limit: 10 })).nextPage).toBe(4);
    expect(documents.search).toHaveBeenLastCalledWith(
      PUBLIC_VIEWER,
      expect.objectContaining({ offset: 20, limit: 10 }),
    );
    // Page 4 of 50 ends at result 200: there is no page 5.
    expect((await service.search(undefined, { q: 'pump', page: 4, limit: 50 })).nextPage).toBe(
      null,
    );
  });

  it('caches signed-out results for equal queries, ignoring case and spacing', async () => {
    const { service, documents } = setup();
    await service.search(undefined, { q: 'Ram  Pump' });
    const second = await service.search(undefined, { q: 'ram pump' });
    expect(documents.search).toHaveBeenCalledTimes(1);
    expect(second.query).toBe('ram pump');
  });

  it('signs previews afresh on a cache hit (no signed link is cached)', async () => {
    const { service } = setup();
    const first = await service.search(undefined, { q: 'pump' });
    const second = await service.search(undefined, { q: 'pump' });
    expect(second.items[0]!.document.currentVersion?.thumbnailUrl).not.toBe(
      first.items[0]!.document.currentVersion?.thumbnailUrl,
    );
  });

  it('never caches signed-in results', async () => {
    const { service, documents } = setup();
    await service.search('u1', { q: 'pump' });
    await service.search('u1', { q: 'pump' });
    expect(documents.search).toHaveBeenCalledTimes(2);
  });

  it('misses the cache after any document write bumps the generation', async () => {
    const cache = memoryCache();
    const { service, documents } = setup({ cache });
    await service.search(undefined, { q: 'pump' });
    await invalidateDocuments(cache, 'jpice');
    await service.search(undefined, { q: 'pump' });
    expect(documents.search).toHaveBeenCalledTimes(2);
    expect([...cache.store.keys()].filter((k) => k.startsWith('search:1:'))).toHaveLength(1);
  });

  it('skips the cache when its generation cannot be read', async () => {
    const getOrSet = vi.fn();
    const cache: Cache = { ...memoryCache(), generation: () => Promise.resolve(null), getOrSet };
    const { service, documents } = setup({ cache });
    await service.search(undefined, { q: 'pump' });
    expect(getOrSet).not.toHaveBeenCalled();
    expect(documents.search).toHaveBeenCalledTimes(1);
  });
});

describe('invalidateDocuments', () => {
  it('clears the organization’s cached lists and bumps the search generation', async () => {
    const cache = memoryCache();
    cache.store.set(cacheKeys.organizationDocuments('jpice', 'h'), '{}');
    cache.store.set(cacheKeys.organizationDocuments('psme', 'h'), '{}');
    await invalidateDocuments(cache, 'jpice');
    expect([...cache.store.keys()].sort()).toEqual(['org:psme:docs:h', 'search:gen']);
    expect(await cache.generation(cacheKeys.searchGeneration())).toBe('1');
  });
});
