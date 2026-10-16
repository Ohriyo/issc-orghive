import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollegeDetail } from '@orghive/shared';
import { routes } from '@/app/router';

const CEA: CollegeDetail = {
  code: 'CEA',
  slug: 'cea',
  name: 'College of Engineering and Architecture',
  motto: null,
  description: 'The College of Engineering and Architecture is home to JPICE and PSME.',
  csc: {
    type: 'CSC',
    slug: 'csc-cea',
    acronym: 'CSC-CEA',
    name: 'Collegiate Student Council of the College of Engineering and Architecture',
    description: 'The CSC-CEA serves as the official student governing body.',
    logoUrl: null,
  },
  sbos: ['JPICE', 'PSME'].map((acronym) => ({
    type: 'SBO',
    slug: acronym.toLowerCase(),
    acronym,
    name: `${acronym} full name`,
    logoUrl: null,
  })),
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

describe('/colleges/:slug', () => {
  it('shows the college, its SBO honeycomb and its CSC card', async () => {
    fetchMock.mockImplementation(() => json(CEA));
    renderAt('/colleges/cea');

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'College of Engineering and Architecture',
      }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/colleges/cea', expect.anything());

    const honeycomb = screen.getByRole('region', {
      name: 'Student body organizations of the College of Engineering and Architecture',
    });
    expect(within(honeycomb).getByRole('link', { name: 'JPICE full name' })).toHaveAttribute(
      'href',
      '/orgs/jpice',
    );

    const csc = screen.getByRole('heading', { level: 2, name: /CSC-CEA/ });
    expect(csc).toHaveTextContent('Collegiate Student Council of the College');
    const pills = within(screen.getByRole('navigation', { name: 'CSC-CEA sections' }));
    expect(pills.getByRole('link', { name: 'Paperworks' })).toHaveAttribute(
      'href',
      '/orgs/csc-cea/paperworks',
    );
    expect(pills.getByRole('link', { name: 'SBO (student body organizations)' })).toHaveAttribute(
      'href',
      '/colleges/cea/organizations',
    );
  });

  it('sets the title, description and Open Graph tags', async () => {
    fetchMock.mockImplementation(() => json(CEA));
    renderAt('/colleges/cea');
    await screen.findByRole('heading', { level: 1, name: CEA.name });

    expect(document.title).toBe('College of Engineering and Architecture | Orghive');
    expect(metaContent('meta[name="description"]')).toBe(CEA.description);
    expect(metaContent('meta[property="og:url"]')).toBe('http://localhost:3000/colleges/cea');
    expect(metaContent('meta[property="og:image"]')).toBe('http://localhost:3000/og-default.png');
  });

  it('shows a skeleton while loading', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    renderAt('/colleges/cea');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Loading the college' }),
    ).toBeInTheDocument();
  });

  it('explains a failed load and retries it', async () => {
    fetchMock.mockImplementationOnce(() =>
      json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } }, 500),
    );
    renderAt('/colleges/cea');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This college could not be loaded');
    fetchMock.mockImplementation(() => json(CEA));
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: CEA.name })).toBeInTheDocument();
  });

  it('shows a not-found page that search engines skip', async () => {
    fetchMock.mockImplementation(() =>
      json({ error: { code: 'NOT_FOUND', message: 'College not found' } }, 404),
    );
    renderAt('/colleges/nope');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'College not found' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all colleges' })).toHaveAttribute(
      'href',
      '/colleges',
    );
    expect(metaContent('meta[name="robots"]')).toBe('noindex');
  });
});
