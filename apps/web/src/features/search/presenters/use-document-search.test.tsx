import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentSummary } from '@orghive/shared';
import { SEARCH_DEBOUNCE_MS, toSearchResult, useDocumentSearch } from './use-document-search';

const fetchMock = vi.fn<typeof fetch>();

const DOC: DocumentSummary = {
  id: '0195f3c0-0000-7000-8000-0000000000d1',
  title: 'Bridge design competition',
  description: null,
  academicYear: '2026-2027',
  semester: 'first',
  status: 'approved',
  visibility: 'public',
  tags: [],
  submittedAt: null,
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

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function respond(items: DocumentSummary[]) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ items, nextCursor: null }), {
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('toSearchResult', () => {
  it('links a document to its organization’s Paperworks', () => {
    expect(toSearchResult(DOC)).toEqual({
      id: DOC.id,
      title: 'Bridge design competition',
      organization: 'JPICE',
      organizationName: 'Junior Philippine Institute of Civil Engineers',
      typeName: 'Activity proposal',
      academicYear: '2026-2027',
      href: '/orgs/jpice/paperworks',
    });
  });
});

describe('useDocumentSearch', () => {
  it('stays idle and sends nothing under two characters', () => {
    const { result } = renderHook(() => useDocumentSearch(), { wrapper });
    act(() => result.current.setQuery('b'));
    expect(result.current.results).toEqual({ status: 'idle' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waits for typing to pause, then searches once', async () => {
    respond([DOC]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useDocumentSearch(), { wrapper });
    act(() => result.current.setQuery('br'));
    act(() => result.current.setQuery('bridge'));
    expect(result.current.results.status).toBe('loading');
    act(() => void vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));

    await waitFor(() => expect(result.current.results.status).toBe('ready'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const input = fetchMock.mock.calls[0]![0];
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    expect(url).toContain('/documents?q=bridge&limit=10');
    expect(result.current.results).toMatchObject({
      status: 'ready',
      query: 'bridge',
      results: [{ title: 'Bridge design competition' }],
    });
  });

  it('reports no matches as empty', async () => {
    respond([]);
    const { result } = renderHook(() => useDocumentSearch(), { wrapper });
    act(() => result.current.setQuery('zzz'));
    await waitFor(() => expect(result.current.results).toEqual({ status: 'empty', query: 'zzz' }));
  });
});
