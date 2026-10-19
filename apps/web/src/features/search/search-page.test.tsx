import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CollegeDetail,
  DocumentSummary,
  OrganizationDetail,
  OrganizationSummary,
  SearchHit,
} from '@orghive/shared';
import { routes } from '@/app/router';
import { toSearchHitCard } from './presenters/use-search-page';

const org = (slug: string, acronym: string, type: 'ISSC' | 'CSC' | 'SBO'): OrganizationSummary => ({
  type,
  slug,
  acronym,
  name: `${acronym} name`,
  logoUrl: null,
  logoSrcSet: null,
});

const ISSC: OrganizationDetail = {
  ...org('issc', 'ISSC', 'ISSC'),
  id: '0195f3c0-0000-7000-8000-0000000000a1',
  description: null,
  parent: null,
  college: null,
};
const CEA: CollegeDetail = {
  code: 'CEA',
  slug: 'cea',
  name: 'College of Engineering and Architecture',
  motto: null,
  description: null,
  csc: { ...org('csc-cea', 'CSC-CEA', 'CSC'), description: null },
  sbos: [org('jpice', 'JPICE', 'SBO'), org('psme', 'PSME', 'SBO')],
};

const DOC: DocumentSummary = {
  id: '0195f3c0-0000-7000-8000-0000000000d1',
  title: 'Narrative Report: Barangay Potable Water Survey',
  description: null,
  academicYear: '2026-2027',
  semester: 'first',
  status: 'available',
  visibility: 'public',
  tags: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  organization: { type: 'SBO', slug: 'jpice', acronym: 'JPICE', name: 'JPICE name' },
  type: { id: '0195f3c0-0000-7000-8000-0000000000e1', slug: 'report', name: 'Report' },
  currentVersion: {
    version: 1,
    originalFilename: 'water.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1000,
    scanStatus: 'clean',
    createdAt: '2026-09-01T00:00:00.000Z',
    thumbnailUrl: 'https://storage.test/thumb.webp',
  },
};
const HIT: SearchHit = {
  document: DOC,
  snippet: [
    { text: 'spring water with a ', match: false },
    { text: 'hydraulic', match: true },
    { text: ' ', match: false },
    { text: 'ram', match: true },
  ],
};

const fetchMock = vi.fn<typeof fetch>();
const urls: string[] = [];

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

function serve({ hits = [HIT], nextPage = null as number | null, searchStatus = 200 } = {}) {
  fetchMock.mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    const path = new URL(url, 'http://localhost').pathname;
    if (path.endsWith('/colleges'))
      return json({ colleges: [{ ...CEA, csc: org('csc-cea', 'CSC-CEA', 'CSC') }] });
    if (path.endsWith('/colleges/cea')) return json(CEA);
    if (path.endsWith('/organizations/issc')) return json(ISSC);
    if (path.endsWith('/document-types')) return json({ types: [DOC.type] });
    if (path.endsWith('/search')) {
      if (searchStatus !== 200) {
        return json({ error: { code: 'INTERNAL', message: 'Down' } }, searchStatus);
      }
      const page = Number(new URL(url, 'http://localhost').searchParams.get('page') ?? 1);
      return json({ query: 'q', items: hits, page, nextPage: page === 1 ? nextPage : null });
    }
    return json({ error: { code: 'UNAUTHORIZED', message: 'No session' } }, 401);
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

const searchCalls = () =>
  urls.filter((u) => new URL(u, 'http://localhost').pathname.endsWith('/search'));

beforeEach(() => {
  urls.length = 0;
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('toSearchHitCard', () => {
  it('shapes a hit for DocumentCard with its preview, organization and excerpt', () => {
    expect(toSearchHitCard(HIT)).toMatchObject({
      id: DOC.id,
      title: DOC.title,
      href: `/documents/${DOC.id}`,
      fileType: 'pdf',
      thumbnailSrc: 'https://storage.test/thumb.webp',
      org: { name: 'JPICE name', shortName: 'JPICE' },
      excerpt: HIT.snippet,
    });
  });
});

describe('/search', () => {
  it('asks for two characters before searching', async () => {
    serve();
    renderAt('/search');
    expect(await screen.findByRole('heading', { level: 1, name: 'Search' })).toBeInTheDocument();
    expect(screen.getByText(/Type at least two characters/)).toBeInTheDocument();
    expect(searchCalls()).toEqual([]);
  });

  it('searches the query in the URL and shows matches with the matched words marked', async () => {
    serve();
    renderAt('/search?q=hydraulic+ram');
    const results = await screen.findByRole('region', { name: 'Results' });
    const card = await within(results).findByRole('link', { name: DOC.title });
    expect(card).toHaveAttribute('href', `/documents/${DOC.id}`);
    expect(within(results).getByText('hydraulic', { selector: 'mark' })).toBeInTheDocument();
    expect(searchCalls()[0]).toContain('q=hydraulic+ram');
    expect(screen.getByRole('searchbox', { name: 'Search Paperworks' })).toHaveValue(
      'hydraulic ram',
    );
  });

  it('passes filters from the URL and lists a college’s CSC and SBOs as organizations', async () => {
    serve();
    renderAt('/search?q=water&college=cea&org=jpice&year=2026-2027');
    await screen.findByRole('link', { name: DOC.title });
    expect(searchCalls()[0]).toMatch(/college=cea/);
    expect(searchCalls()[0]).toMatch(/org=jpice/);
    expect(searchCalls()[0]).toMatch(/year=2026-2027/);
    const orgSelect = screen.getAllByRole('combobox', { name: 'Organization' })[0]!;
    await waitFor(() =>
      expect(
        within(orgSelect)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['All organizations', 'CSC-CEA', 'JPICE', 'PSME']),
    );
  });

  it('drops the organization when the college changes, and keeps the query on Clear', async () => {
    serve();
    const router = renderAt('/search?q=water&college=cea&org=jpice');
    await screen.findByRole('link', { name: DOC.title });
    fireEvent.change(screen.getAllByRole('combobox', { name: 'College' })[0]!, {
      target: { value: '' },
    });
    await waitFor(() => expect(router.state.location.search).toBe('?q=water'));

    fireEvent.change(screen.getAllByRole('combobox', { name: 'Type' })[0]!, {
      target: { value: 'report' },
    });
    await waitFor(() => expect(router.state.location.search).toBe('?q=water&type=report'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(router.state.location.search).toBe('?q=water'));
  });

  it('offers the ISSC and the CSCs without a college', async () => {
    serve();
    renderAt('/search?q=water');
    const orgSelect = (await screen.findAllByRole('combobox', { name: 'Organization' }))[0]!;
    await waitFor(() =>
      expect(
        within(orgSelect)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['All organizations', 'ISSC', 'CSC-CEA']),
    );
  });

  it('loads more results by page', async () => {
    serve({ nextPage: 2 });
    renderAt('/search?q=water');
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(searchCalls().some((u) => u.includes('page=2'))).toBe(true));
  });

  it('says so when nothing matches', async () => {
    serve({ hits: [] });
    renderAt('/search?q=zzzz');
    expect(await screen.findByText(/No Paperworks match “zzzz”/)).toBeInTheDocument();
  });

  it('shows an error with a retry', async () => {
    serve({ searchStatus: 500 });
    renderAt('/search?q=water');
    expect(await screen.findByText(/Search is not available right now/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
  });
});
