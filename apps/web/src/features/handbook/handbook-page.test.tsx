import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandbookEditionList, HandbookResponse, HandbookSearchResponse } from '@orghive/shared';
import { routes } from '@/app/router';
import { authStore } from '@/lib/auth-store';
import { accountSession } from '@/test/accounts';
import {
  activeEntryKey,
  flattenOutline,
  NOTHING_YET_POLL_MS,
  pollWhileNothing,
  yearLabel,
} from './presenters/use-handbook';
import { toEditionCard } from './presenters/use-handbook-editions';

const DOCUMENT_ID = '0195f3c0-0000-7000-8000-0000000000d1';
const EDITION: NonNullable<HandbookResponse['edition']> = {
  academicYear: '2026-2027',
  isCurrent: true,
  pageCount: 40,
  coverUrl: null,
  documentId: DOCUMENT_ID,
  versionId: '0195f3c0-0000-7000-8000-0000000000f1',
  previewStatus: 'ready',
  outline: [
    { title: 'Welcome', page: 1, items: [] },
    { title: 'Student conduct', page: 5, items: [{ title: 'Dress code', page: 7, items: [] }] },
  ],
  thumbnails: true,
  publishedAt: '2026-08-01T00:00:00.000Z',
};

describe('handbook shaping', () => {
  it('writes the year with an en dash', () => {
    expect(yearLabel('2026-2027')).toBe('2026–2027');
  });

  it('flattens the bookmarks in reading order and finds the section a page is in', () => {
    const entries = flattenOutline(EDITION.outline!);
    expect(entries.map((e) => [e.title, e.page, e.depth])).toEqual([
      ['Welcome', 1, 0],
      ['Student conduct', 5, 0],
      ['Dress code', 7, 1],
    ]);
    expect(activeEntryKey(entries, 6)).toBe('1');
    expect(activeEntryKey(entries, 30)).toBe('1.0');
  });

  it('opens every edition by its year, the current one too', () => {
    expect(toEditionCard({ ...EDITION }).href).toBe('/handbook/2026-2027');
    expect(toEditionCard({ ...EDITION, isCurrent: false }).href).toBe('/handbook/2026-2027');
  });

  it('looks again while no edition is readable, and stops once one is', () => {
    expect(pollWhileNothing({ state: { data: { edition: null } } })).toBe(NOTHING_YET_POLL_MS);
    expect(pollWhileNothing({ state: { data: { edition: EDITION } } })).toBe(false);
    expect(pollWhileNothing({ state: {} })).toBe(false);
  });
});

const fetchMock = vi.fn<typeof fetch>();
const asked: string[] = [];

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

const PAST: NonNullable<HandbookResponse['edition']> = {
  ...EDITION,
  academicYear: '2025-2026',
  isCurrent: false,
  outline: null,
};

function serve(
  edition: HandbookResponse['edition'] = EDITION,
  viewerStatus: 'pending' | 'failed' = 'pending',
) {
  fetchMock.mockImplementation((input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, 'http://localhost');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = init?.method ?? 'GET';
    asked.push(`${method === 'GET' ? '' : `${method} `}${path}${url.search}`);
    if (path === '/auth/refresh') return json(accountSession('issc'));
    if (path === '/handbook') return json({ edition } satisfies HandbookResponse);
    if (path === '/handbook/2025-2026') return json({ edition: PAST } satisfies HandbookResponse);
    if (path === '/admin/handbook/2026-2027/preview/retry') return json({ editions: [] });
    if (path === '/handbook/search') {
      return json({
        query: url.searchParams.get('q') ?? '',
        matches: [{ page: 7, snippet: [{ text: 'dress', match: true }, { text: ' code', match: false }] }],
      } satisfies HandbookSearchResponse);
    }
    if (path === '/handbook/editions') {
      return json({
        editions: [
          { academicYear: '2026-2027', isCurrent: true, pageCount: 40, coverUrl: null },
          { academicYear: '2025-2026', isCurrent: false, pageCount: 36, coverUrl: null },
        ],
      } satisfies HandbookEditionList);
    }
    if (path === `/documents/${DOCUMENT_ID}/viewer`) {
      return json({
        versionId: EDITION.versionId,
        status: viewerStatus,
        pages: [],
        totalPages: 0,
        token: null,
        expiresAt: null,
      });
    }
    return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  });
}

function renderAt(url: string) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  asked.length = 0;
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  authStore.reset();
});

describe('/handbook', () => {
  it('shows the current edition with its bookmarks as the contents', async () => {
    serve();
    renderAt('/handbook');
    expect(await screen.findByRole('heading', { level: 1, name: 'Student Handbook' })).toBeInTheDocument();
    expect(screen.getByText(/The 2026–2027 edition, 40 pages/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Past editions' })).toHaveAttribute(
      'href',
      '/handbook/editions',
    );
    // jsdom has no layout: the page is the phone layout, contents in the sheet.
    fireEvent.click(screen.getByRole('button', { name: 'Contents and search' }));
    const sheet = await screen.findByRole('dialog', { name: 'Contents and search' });
    const contents = within(sheet).getByRole('navigation', { name: 'Contents' });
    expect(within(contents).getByRole('button', { name: /Dress code\s*page 7/ })).toBeInTheDocument();
  });

  it('searches inside the handbook and lists the matching pages', async () => {
    serve();
    renderAt('/handbook');
    fireEvent.click(await screen.findByRole('button', { name: 'Contents and search' }));
    const sheet = await screen.findByRole('dialog', { name: 'Contents and search' });
    fireEvent.change(within(sheet).getByLabelText('Search the handbook'), {
      target: { value: 'dress' },
    });
    expect(await within(sheet).findByText('1 page matches')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /Page 7/ })).toBeInTheDocument();
    await waitFor(() => expect(asked).toContain('/handbook/search?q=dress'));
  });

  it('says plainly when no edition is published yet', async () => {
    serve(null);
    renderAt('/handbook');
    expect(
      await screen.findByText(/The Student Handbook has not been published here yet/),
    ).toBeInTheDocument();
  });

  it('lists every edition, current first', async () => {
    serve();
    renderAt('/handbook/editions');
    const current = await screen.findByRole('link', { name: /2026–2027\s*Current edition, 40 pages/ });
    expect(current).toHaveAttribute('href', '/handbook/2026-2027');
    expect(screen.getByRole('link', { name: /2025–2026\s*Past edition, 36 pages/ })).toHaveAttribute(
      'href',
      '/handbook/2025-2026',
    );
  });

  it('always asks the server, never the browser cache', async () => {
    serve();
    renderAt('/handbook');
    await screen.findByRole('heading', { level: 1, name: 'Student Handbook' });
    const handbookCall = fetchMock.mock.calls.find(
      ([input]) => typeof input === 'string' && input.endsWith('/handbook'),
    );
    expect(handbookCall?.[1]).toMatchObject({ cache: 'no-cache' });
  });

  it('marks a past edition and links to the current one', async () => {
    serve();
    renderAt('/handbook/2025-2026');
    expect(await screen.findByText('Past edition')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View current edition' })).toHaveAttribute('href', '/handbook');
  });

  it('says the pages are being prepared while the worker renders them', async () => {
    serve();
    renderAt('/handbook');
    expect(await screen.findByText('Preparing pages…')).toBeInTheDocument();
  });

  it('lets only the ISSC account retry pages that could not be prepared', async () => {
    serve(EDITION, 'failed');
    renderAt('/handbook');
    expect(await screen.findByText('No preview for this file')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry rendering' })).not.toBeInTheDocument();
    cleanup();

    authStore.setSession(accountSession('issc'));
    renderAt('/handbook');
    fireEvent.click(await screen.findByRole('button', { name: 'Retry rendering' }));
    await waitFor(() => expect(asked).toContain('POST /admin/handbook/2026-2027/preview/retry'));
  });
});
