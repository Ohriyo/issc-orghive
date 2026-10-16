import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrganizationDetail } from '@orghive/shared';
import { routes } from '@/app/router';

const JPICE: OrganizationDetail = {

  id: '0195f3c0-0000-7000-8000-0000000000b1',
  type: 'SBO',
  slug: 'jpice',
  acronym: 'JPICE',
  name: 'Junior Philippine Institute of Civil Engineers',
  description: 'The JPICE is a dynamic organization committed to civil engineering students.',
  logoUrl: 'https://cdn.test/logos/jpice.png',
  logoSrcSet: null,
  parent: null,
  college: { code: 'CEA', slug: 'cea', name: 'College of Engineering and Architecture' },
};

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
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

function metaContent(selector: string) {
  return document.head.querySelector(selector)?.getAttribute('content');
}

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('/orgs/:slug', () => {
  it('shows the acronym, full name, description, Paperworks and its college', async () => {
    fetchMock.mockImplementation(() => json(JPICE));
    renderAt('/orgs/jpice');

    const heading = await screen.findByRole('heading', { level: 1, name: /^JPICE/ });
    expect(heading).toHaveTextContent('JPICE');
    expect(heading).toHaveTextContent(JPICE.name);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/organizations/jpice', expect.anything());
    expect(screen.getByText('JPICE', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Paperworks' })).toHaveAttribute(
      'href',
      '/orgs/jpice/paperworks',
    );
    expect(
      screen.getByRole('link', { name: 'College of Engineering and Architecture' }),
    ).toHaveAttribute('href', '/colleges/cea');
  });

  it('uses the organization logo as its Open Graph image', async () => {
    fetchMock.mockImplementation(() => json(JPICE));
    renderAt('/orgs/jpice');
    await screen.findByRole('link', { name: 'Paperworks' });

    expect(document.title).toBe('Junior Philippine Institute of Civil Engineers (JPICE) | Orghive');
    expect(metaContent('meta[name="description"]')).toBe(JPICE.description);
    expect(metaContent('meta[property="og:image"]')).toBe(JPICE.logoUrl);
    expect(metaContent('meta[name="twitter:card"]')).toBe('summary');
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'http://localhost:3000/orgs/jpice',
    );
  });

  it('shows a skeleton while loading', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    renderAt('/orgs/jpice');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Loading the organization' }),
    ).toBeInTheDocument();
  });

  it('shows a not-found page for an unknown organization', async () => {
    fetchMock.mockImplementation(() =>
      json({ error: { code: 'NOT_FOUND', message: 'Organization not found' } }, 404),
    );
    renderAt('/orgs/nope');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Organization not found' }),
    ).toBeInTheDocument();
  });

  it('explains a failed load', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('offline')));
    renderAt('/orgs/jpice');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This organization could not be loaded',
    );
  });
});

describe('/organizations/:slug', () => {
  it('redirects old links to /orgs, keeping the rest of the path', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const router = renderAt('/organizations/jpice/paperworks?term=1');
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/orgs/jpice/paperworks'));
    expect(router.state.location.search).toBe('?term=1');
  });
});
