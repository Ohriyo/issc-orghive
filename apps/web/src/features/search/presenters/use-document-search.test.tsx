import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentSummary, SearchHit } from '@orghive/shared';
import { SEARCH_DEBOUNCE_MS, toSearchResult, useDocumentSearch } from './use-document-search';
import { isSearchHotkey } from './use-search-hotkey';

const fetchMock = vi.fn<typeof fetch>();

const DOC: DocumentSummary = {
  id: '0195f3c0-0000-7000-8000-0000000000d1',
  title: 'Bridge design competition',
  description: null,
  academicYear: '2026-2027',
  semester: 'first',
  status: 'available',
  visibility: 'public',
  tags: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  organization: {
    type: 'SBO',
    slug: 'jpice',
    acronym: 'JPICE',
    name: 'Junior Philippine Institute of Civil Engineers',
  },
  type: { id: '0195f3c0-0000-7000-8000-0000000000e1', slug: 'proposal', name: 'Activity proposal' },
  currentVersion: null,
};

const HIT: SearchHit = {
  document: DOC,
  snippet: [
    { text: 'a truss ', match: false },
    { text: 'bridge', match: true },
  ],
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function respond(items: SearchHit[], nextPage: number | null = null) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ query: 'bridge', items, page: 1, nextPage }), {
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function requestedUrl(call = 0): string {
  const input = fetchMock.mock.calls[call]![0];
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('toSearchResult', () => {
  it('links a hit to the document page and keeps its snippet', () => {
    expect(toSearchResult(HIT)).toEqual({
      id: DOC.id,
      title: 'Bridge design competition',
      organization: 'JPICE',
      organizationName: 'Junior Philippine Institute of Civil Engineers',
      typeName: 'Activity proposal',
      academicYear: '2026-2027',
      href: `/documents/${DOC.id}`,
      snippet: HIT.snippet,
    });
  });
});

describe('isSearchHotkey', () => {
  const key = (init: Partial<KeyboardEvent>) => ({
    key: 'k',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  });

  it('accepts Ctrl+K and Cmd+K, in either case', () => {
    expect(isSearchHotkey(key({ ctrlKey: true }))).toBe(true);
    expect(isSearchHotkey(key({ metaKey: true, key: 'K' }))).toBe(true);
  });

  it('ignores K alone and other modifier combinations', () => {
    expect(isSearchHotkey(key({}))).toBe(false);
    expect(isSearchHotkey(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isSearchHotkey(key({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isSearchHotkey(key({ ctrlKey: true, key: 'j' }))).toBe(false);
  });
});

describe('useDocumentSearch', () => {
  it('stays idle and sends nothing under two characters', () => {
    const { result } = renderHook(() => useDocumentSearch(), { wrapper });
    act(() => result.current.setQuery('b'));
    expect(result.current.results).toEqual({ status: 'idle' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waits for typing to pause, then searches /search once', async () => {
    respond([HIT]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useDocumentSearch(), { wrapper });
    act(() => result.current.setQuery('br'));
    act(() => result.current.setQuery('bridge'));
    expect(result.current.results.status).toBe('loading');
    act(() => void vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));

    await waitFor(() => expect(result.current.results.status).toBe('ready'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedUrl()).toContain('/search?q=bridge&limit=8');
    expect(result.current.results).toMatchObject({
      status: 'ready',
      query: 'bridge',
      hasMore: false,
      results: [{ title: 'Bridge design competition', snippet: HIT.snippet }],
    });
  });

  it('says when there are more results than the overlay shows', async () => {
    respond([HIT], 2);
    const { result } = renderHook(() => useDocumentSearch(), { wrapper });
    act(() => result.current.setQuery('bridge'));
    await waitFor(() => expect(result.current.results).toMatchObject({ hasMore: true }));
    expect(result.current.allResultsHref).toBe('/search?q=bridge');
  });

  it('reports no matches as empty', async () => {
    respond([]);
    const { result } = renderHook(() => useDocumentSearch(), { wrapper });
    act(() => result.current.setQuery('zzz'));
    await waitFor(() => expect(result.current.results).toEqual({ status: 'empty', query: 'zzz' }));
  });

  it('opens on Ctrl+K and Cmd+K', () => {
    const { result } = renderHook(() => useDocumentSearch(), { wrapper });
    expect(result.current.open).toBe(false);
    act(() => void fireEvent.keyDown(window, { key: 'k', ctrlKey: true }));
    expect(result.current.open).toBe(true);
    act(() => result.current.setOpen(false));
    act(() => void fireEvent.keyDown(window, { key: 'k', metaKey: true }));
    expect(result.current.open).toBe(true);
  });

  it('opens the full results page on submit and closes the overlay', () => {
    const { result } = renderHook(
      () => ({ search: useDocumentSearch(), location: useLocation() }),
      { wrapper },
    );
    act(() => result.current.search.setOpen(true));
    act(() => result.current.search.setQuery('ram pump'));
    act(() => result.current.search.submit());
    expect(result.current.search.open).toBe(false);
    expect(result.current.location.pathname + result.current.location.search).toBe(
      '/search?q=ram+pump',
    );
  });

  it('does not submit a query that is too short', () => {
    const { result } = renderHook(() => useDocumentSearch(), { wrapper });
    act(() => result.current.setOpen(true));
    act(() => result.current.setQuery('r'));
    act(() => result.current.submit());
    expect(result.current.open).toBe(true);
  });
});
