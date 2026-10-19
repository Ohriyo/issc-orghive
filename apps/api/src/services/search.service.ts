import { createHash } from 'node:crypto';
import {
  parseSnippet,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_RESULTS,
  type SearchQuery,
  type SearchResponse,
  type SearchSnippet,
  trimSnippetLead,
} from '@orghive/shared';
import { type Cache, cacheKeys } from '#src/lib/cache';
import type { Storage } from '#src/lib/storage';
import type { DocumentRepository } from '#src/repositories/document.repository';
import { PUBLIC_VIEWER } from '#src/repositories/document-visibility';
import {
  presentSummary,
  toStoredSummary,
  type StoredSummary,
} from '#src/services/document.service';
import type { DocumentViewerService } from '#src/services/document-viewer.service';

/** Signed-out searches are cached this long (any repeated query is a popular one). */
export const SEARCH_CACHE_TTL_SECONDS = 5 * 60;

export interface SearchServiceDeps {
  documents: Pick<DocumentRepository, 'search'>;
  viewers: Pick<DocumentViewerService, 'forUser'>;
  storage: Pick<Storage, 'presignGet'>;
  cache: Pick<Cache, 'getOrSet' | 'generation'>;
}

/** A response as cached: previews as storage keys, signed only when served. */
interface StoredResponse {
  query: string;
  page: number;
  nextPage: number | null;
  items: { document: StoredSummary; snippet: SearchSnippet | null }[];
}

/**
 * Search matches words case-insensitively, so queries differing only in case or spacing
 * share one cache entry.
 */
function normalize(query: SearchQuery): SearchQuery {
  return { ...query, q: query.q.toLowerCase().replace(/\s+/g, ' ') };
}

/**
 * The passage around the matched words. When only the title or tags matched, `ts_headline`
 * falls back to the file's first words (usually its letterhead), so the description is
 * shown instead, or nothing.
 */
function snippetOf(headline: string | null, description: string | null): SearchSnippet | null {
  const parts = headline ? parseSnippet(headline) : [];
  if (parts.some((part) => part.match)) return trimSnippetLead(parts);
  return description ? [{ text: description, match: false }] : null;
}

function hashOf(query: SearchQuery): string {
  const sorted = Object.entries(query)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 32);
}

/**
 * Full-text search across every organization's Paperworks. Who sees which result is the
 * repository's visibility filter alone; this service only pages, shapes and caches.
 */
export function createSearchService({ documents, viewers, storage, cache }: SearchServiceDeps) {
  async function load(userId: string | undefined, query: SearchQuery): Promise<StoredResponse> {
    const limit = query.limit ?? SEARCH_DEFAULT_LIMIT;
    const page = query.page ?? 1;
    const offset = (page - 1) * limit;
    const empty = { query: query.q, page, nextPage: null, items: [] };
    if (offset >= SEARCH_MAX_RESULTS) return empty;

    const viewer = userId ? await viewers.forUser(userId) : PUBLIC_VIEWER;
    const { items, hasMore } = await documents.search(viewer, {
      query: query.q,
      collegeSlug: query.college,
      organizationSlug: query.org,
      typeSlug: query.type,
      academicYear: query.year,
      offset,
      limit: Math.min(limit, SEARCH_MAX_RESULTS - offset),
    });
    return {
      query: query.q,
      page,
      nextPage: hasMore && offset + limit < SEARCH_MAX_RESULTS ? page + 1 : null,
      items: items.map(({ headline, ...doc }) => ({
        document: toStoredSummary(doc),
        snippet: snippetOf(headline, doc.description),
      })),
    };
  }

  /** Signed-in results depend on memberships, so only signed-out results are cached. */
  async function stored(userId: string | undefined, query: SearchQuery) {
    if (userId) return load(userId, query);
    const generation = await cache.generation(cacheKeys.searchGeneration());
    if (generation === null) return load(undefined, query);
    const key = cacheKeys.search(generation, hashOf(query));
    return (await cache.getOrSet(key, SEARCH_CACHE_TTL_SECONDS, () => load(undefined, query)))!;
  }

  return {
    async search(userId: string | undefined, raw: SearchQuery): Promise<SearchResponse> {
      const result = await stored(userId, normalize(raw));
      return {
        ...result,
        items: await Promise.all(
          result.items.map(async ({ document, snippet }) => ({
            document: await presentSummary(storage, document),
            snippet,
          })),
        ),
      };
    },
  };
}

export type SearchService = ReturnType<typeof createSearchService>;
