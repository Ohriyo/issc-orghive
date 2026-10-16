import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentSummary, OrganizationDetail } from '@orghive/shared';
import { routes } from '@/app/router';
import { academicYearOf, toDocumentCard, yearOptions } from './presenters/use-paperworks';

const JPICE: OrganizationDetail = {
  id: '0195f3c0-0000-7000-8000-0000000000b1',
  type: 'SBO',
  slug: 'jpice',
  acronym: 'JPICE',
  name: 'Junior Philippine Institute of Civil Engineers',
  description: null,
  logoUrl: null,
  logoSrcSet: null,
  parent: null,
  college: null,
};

const PROPOSAL = {
  id: '0195f3c0-0000-7000-8000-0000000000e1',
  slug: 'activity-proposal',
  name: 'Activity proposal',
};

function doc(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id: '0195f3c0-0000-7000-8000-0000000000d1',
    title: 'Bridge design competition',
    description: null,
    academicYear: '2026-2027',
    semester: 'first',
    status: 'approved',
    visibility: 'public',
    tags: [],
    submittedAt: '2026-09-01T00:00:00.000Z',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    organization: { type: 'SBO', slug: 'jpice', acronym: 'JPICE', name: JPICE.name },
    type: PROPOSAL,
    currentVersion: {
      version: 1,
      originalFilename: 'bridge.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
      scanStatus: 'clean',
      createdAt: '2026-08-20T00:00:00.000Z',
      thumbnailUrl: null,
    },
    ...overrides,
  };
}

const fetchMock = vi.fn<typeof fetch>();
const urls: string[] = [];

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

function serve({
  docs = [doc()],
  orgStatus = 200,
}: { docs?: DocumentSummary[]; orgStatus?: number } = {}) {
  fetchMock.mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    if (url.endsWith('/organizations/jpice') || url.endsWith('/organizations/nope')) {
      return orgStatus === 200
        ? json(JPICE)
        : json({ error: { code: 'NOT_FOUND', message: 'Organization not found' } }, orgStatus);
    }
    if (url.endsWith('/document-types')) return json({ types: [PROPOSAL] });
    if (url.includes('/organizations/jpice/documents'))
      return json({ items: docs, nextCursor: null });
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

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  urls.length = 0;
  vi.unstubAllGlobals();
});

describe('usePaperworks helpers', () => {
  it('knows the academic year starts in August', () => {
    expect(academicYearOf(new Date('2026-10-16'))).toBe('2026-2027');
    expect(academicYearOf(new Date('2027-03-01'))).toBe('2026-2027');
    expect(yearOptions(new Date('2026-10-16'), 3).map((o) => o.value)).toEqual([
      '2026-2027',
      '2025-2026',
      '2024-2025',
    ]);
  });

  it('shapes a card: file type from the MIME type, status only when not approved', () => {
    const now = new Date('2026-09-05').getTime();
    expect(toDocumentCard(doc(), now)).toMatchObject({
      href: '/documents/0195f3c0-0000-7000-8000-0000000000d1',
      typeLabel: 'Activity proposal',
      fileType: 'pdf',
      isNew: true,
      status: undefined,
    });
    expect(toDocumentCard(doc({ status: 'pending', currentVersion: null }), now)).toMatchObject({
      status: 'pending',
      fileType: undefined,
    });
  });
});

describe('/orgs/:slug/paperworks', () => {
  it('lists the organization’s documents as cards linking to each document', async () => {
    serve();
    renderAt('/orgs/jpice/paperworks');
    expect(
      // The first test in the file also loads the lazy route, so give it longer.
      await screen.findByRole('heading', { level: 1, name: 'Paperworks' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(JPICE.name)).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: 'Bridge design competition' });
    expect(link).toHaveAttribute('href', '/documents/0195f3c0-0000-7000-8000-0000000000d1');
  });

  it('filters by type through the URL and the request', async () => {
    serve();
    const router = renderAt('/orgs/jpice/paperworks');
    await screen.findByRole('link', { name: 'Bridge design competition' });
    // Both layouts render in jsdom (CSS decides which shows); use the inline row's select.
    const select = (await screen.findAllByRole('combobox', { name: 'Type' }))[0]!;
    await waitFor(() =>
      expect(within(select).getByRole('option', { name: 'Activity proposal' })).toBeInTheDocument(),
    );
    fireEvent.change(select, { target: { value: 'activity-proposal' } });
    await waitFor(() => expect(router.state.location.search).toBe('?type=activity-proposal'));
    await waitFor(() => expect(urls.some((u) => u.includes(`typeId=${PROPOSAL.id}`))).toBe(true));
  });

  it('opens the filters in a bottom sheet dialog on phones', async () => {
    serve();
    renderAt('/orgs/jpice/paperworks');
    fireEvent.click(await screen.findByRole('button', { name: /Filters/ }));
    const sheet = screen.getByRole('dialog', { name: 'Filters' });
    expect(within(sheet).getByRole('combobox', { name: 'Academic year' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Show results' })).toBeInTheDocument();
  });

  it('explains an empty archive', async () => {
    serve({ docs: [] });
    renderAt('/orgs/jpice/paperworks');
    expect(
      await screen.findByText(/No Paperworks have been published here yet/),
    ).toBeInTheDocument();
  });

  it('shows not found for an unknown organization', async () => {
    serve({ orgStatus: 404 });
    renderAt('/orgs/nope/paperworks');
    expect(
      await screen.findByRole('heading', { name: 'Organization not found' }),
    ).toBeInTheDocument();
  });
});

describe('/documents/:id', () => {
  it('shows the document’s details and links back to its Paperworks', async () => {
    fetchMock.mockImplementation(() => json(doc({ description: 'A truss bridge contest.' })));
    renderAt('/documents/0195f3c0-0000-7000-8000-0000000000d1');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Bridge design competition' }),
    ).toBeInTheDocument();
    expect(screen.getByText('2026-2027, First semester')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'JPICE Paperworks' })).toHaveAttribute(
      'href',
      '/orgs/jpice/paperworks',
    );
  });

  it('treats a document the viewer may not see as not found', async () => {
    fetchMock.mockImplementation(() =>
      json({ error: { code: 'NOT_FOUND', message: 'Document not found' } }, 404),
    );
    renderAt('/documents/0195f3c0-0000-7000-8000-0000000000d1');
    expect(await screen.findByRole('heading', { name: 'Document not found' })).toBeInTheDocument();
  });
});
