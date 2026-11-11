import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
  tagline: null,
  description: 'The JPICE is a dynamic organization committed to civil engineering students.',
  logoUrl: 'https://cdn.test/logos/jpice.png',
  logoSrcSet: null,
  parent: null,
  college: { code: 'CEA', slug: 'cea', name: 'College of Engineering and Architecture' },
  mission: null,
  vision: null,
  contactEmail: null,
  links: [],
  officers: [],
  coverUrl: null,
  coverSrcSet: null,
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
    expect(await screen.findByRole('link', { name: /^Open Paperworks/ })).toHaveAttribute(
      'href',
      '/orgs/jpice/paperworks',
    );
    for (const college of screen.getAllByRole('link', {
      name: 'College of Engineering and Architecture',
    })) {
      expect(college).toHaveAttribute('href', '/colleges/cea');
    }
  });

  it('says "Sample data" on an organization showing demo data, and only there', async () => {
    const demo = (organizations: string[]) =>
      fetchMock.mockImplementation((input) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        return url.endsWith('/demo-status') ? json({ organizations }) : json(JPICE);
      });
    demo(['jpice']);
    renderAt('/orgs/jpice');
    expect(await screen.findByText('Sample data')).toBeInTheDocument();
    cleanup();
    demo(['asit']);
    renderAt('/orgs/jpice');
    await screen.findByRole('heading', { level: 1, name: /^JPICE/ });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/demo-status', expect.anything()),
    );
    expect(screen.queryByText('Sample data')).not.toBeInTheDocument();
  });

  it('uses the organization logo as its Open Graph image', async () => {
    fetchMock.mockImplementation(() => json(JPICE));
    renderAt('/orgs/jpice');
    await screen.findByRole('link', { name: /^Open Paperworks/ });

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

describe('/orgs/:slug profile sections', () => {
  const PROFILED: OrganizationDetail = {
    ...JPICE,
    mission: 'Shape competent civil engineers.',
    vision: 'Engineers who build for the public good.',
    contactEmail: 'jpice@nwssu.edu.ph',
    links: [{ url: 'https://www.facebook.com/jpice.nwssu/', kind: 'facebook', label: 'Facebook' }],
    officers: [{ position: 'President', name: 'Maria Clara Santos' }],
  };
  const DOCUMENT_ID = '0195f3c0-0000-7000-8000-0000000000d1';

  function routeFetch(constitution: unknown) {
    fetchMock.mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/organizations/jpice/constitution')) return json(constitution);
      if (url.endsWith('/organizations/jpice')) return json(PROFILED);
      return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    });
  }

  it('shows the mission, vision, public officers and contact links', async () => {
    routeFetch({ constitution: null });
    renderAt('/orgs/jpice');

    expect(
      await screen.findByRole('heading', { level: 2, name: 'About' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Shape competent civil engineers.')).toBeInTheDocument();
    expect(screen.getByText('Maria Clara Santos')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Email jpice@nwssu\.edu\.ph/ })).toHaveAttribute(
      'href',
      'mailto:jpice@nwssu.edu.ph',
    );
    const facebook = screen.getByRole('link', { name: /Facebook facebook\.com\/jpice\.nwssu/ });
    expect(facebook).toHaveAttribute('target', '_blank');
    expect(facebook).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('says plainly when the constitution has not been uploaded', async () => {
    routeFetch({ constitution: null });
    renderAt('/orgs/jpice');
    expect(
      await screen.findByText('JPICE has not uploaded its Constitution & By-laws.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Upload it from your profile' })).toBeNull();
  });

  it('opens the constitution in the viewer, with its last amendment and history', async () => {
    routeFetch({
      constitution: {
        documentId: DOCUMENT_ID,
        lastAmendedOn: '2026-09-15',
        versions: [
          {
            id: '0195f3c0-0000-7000-8000-0000000000f2',
            version: 2,
            amendedOn: '2026-09-15',
            note: 'Article III amended.',
            isCurrent: true,
            uploadedAt: '2026-09-16T00:00:00.000Z',
            scanStatus: 'clean',
            previewStatus: 'ready',
            actingAs: null,
          },
          {
            id: '0195f3c0-0000-7000-8000-0000000000f1',
            version: 1,
            amendedOn: '2025-08-04',
            note: null,
            isCurrent: false,
            uploadedAt: '2025-08-05T00:00:00.000Z',
            scanStatus: 'clean',
            previewStatus: 'ready',
            actingAs: null,
          },
        ],
      },
    });
    renderAt('/orgs/jpice');

    expect(await screen.findByRole('link', { name: 'Read the constitution' })).toHaveAttribute(
      'href',
      `/documents/${DOCUMENT_ID}`,
    );
    expect(screen.getByText('Last amended September 15, 2026')).toBeInTheDocument();
    expect(screen.getByText('Amendment history (2 versions)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View this version', hidden: true })).toHaveAttribute(
      'href',
      `/documents/${DOCUMENT_ID}?version=0195f3c0-0000-7000-8000-0000000000f1`,
    );
  });
});

describe('/orgs/:slug highlights and updates', () => {
  const post = (n: number, type: 'HIGHLIGHT' | 'UPDATE') => ({
    id: `0195f3c0-0000-7000-8000-00000000010${n}`,
    slug: `post-${n}`,
    type,
    title: `${type === 'HIGHLIGHT' ? 'Highlight' : 'Update'} number ${n}`,
    summary: 'A short summary.',
    eventDate: null,
    publishedAt: '2026-11-05T10:00:00.000Z',
    cover: null,
    externalLink: null,
  });

  function stub(highlights: unknown[], updates: unknown[]) {
    fetchMock.mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/organizations/jpice/page')) {
        return json({
          organization: JPICE,
          highlights,
          updates,
          updatesTotal: updates.length,
          viewer: { isOwner: false, canModerate: false },
        });
      }
      return json(JPICE);
    });
  }

  it('shows the pinned highlights and the newest updates', async () => {
    stub([post(1, 'HIGHLIGHT'), post(2, 'HIGHLIGHT')], [post(3, 'UPDATE')]);
    renderAt('/orgs/jpice');
    expect(await screen.findByRole('region', { name: 'JPICE highlights' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Highlight number 1' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Update number 3' })).toHaveAttribute(
      'href',
      '/orgs/jpice/updates/post-3',
    );
    expect(screen.getByRole('link', { name: /View all updates/ })).toHaveAttribute(
      'href',
      '/orgs/jpice/updates',
    );
  });

  it('hides both sections when the organization has no posts', async () => {
    stub([], []);
    renderAt('/orgs/jpice');
    await screen.findByRole('heading', { level: 1, name: /^JPICE/ });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/organizations/jpice/page', expect.anything()),
    );
    expect(screen.queryByRole('heading', { name: 'Highlights' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Updates' })).toBeNull();
  });
});

describe('/orgs/:slug template sections', () => {
  const doc = (n: number) => `0195f3c0-0000-7000-8000-0000000002${String(n).padStart(2, '0')}`;
  const project = (n: number, date: string) => ({
    id: doc(n),
    title: `Project ${n}`,
    date,
    location: 'CEA Building',
    beneficiaries: 'Civil engineering students',
    files: n === 1 ? [{ documentId: doc(50), label: 'Project Proposal' }] : [],
  });
  const SHOWCASE = {
    rank: { board: 'SBO', rank: 3, academicYear: '2026-2027', semester: 'first', status: 'provisional' },
    projectSemesters: [
      {
        academicYear: '2026-2027',
        semester: 'first',
        projects: [project(1, '2026-09-15'), project(2, '2026-09-01'), project(3, '2026-08-20')],
      },
      { academicYear: '2025-2026', semester: 'second', projects: [project(4, '2026-03-02')] },
    ],
    documents: [
      { id: doc(60), title: 'CE Week report', typeName: 'Accomplishment report', createdAt: '2026-09-25T02:00:00.000Z' },
    ],
    publicDocumentCount: 24,
  };

  function stub(isOwner: boolean) {
    fetchMock.mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/organizations/jpice/showcase')) return json(SHOWCASE);
      if (url.endsWith('/organizations/jpice/page')) {
        return json({
          organization: JPICE,
          highlights: [],
          updates: [],
          updatesTotal: 0,
          viewer: { isOwner, canModerate: false },
        });
      }
      if (url.endsWith('/organizations/jpice/constitution')) return json({ constitution: null });
      return json({ ...JPICE, tagline: 'Building communities, one project at a time.' });
    });
  }

  it('shows the tagline, the rank badge, projects by semester and the public documents', async () => {
    stub(false);
    renderAt('/orgs/jpice');

    expect(await screen.findByText('Building communities, one project at a time.')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /3rd on the SBO leaderboard/ })).toHaveAttribute(
      'href',
      '/leaderboard',
    );
    expect(screen.getByRole('heading', { level: 3, name: '1st semester 2026-2027' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Project Proposal' })).toHaveAttribute(
      'href',
      `/documents/${doc(50)}`,
    );
    expect(screen.getAllByText('No public documents for this project.')).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: 'Project 4' })).toBeNull();
    screen.getByRole('button', { name: /Show 1 earlier project/ }).click();
    expect(await screen.findByRole('heading', { name: 'Project 4' })).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'View CE Week report' })).toHaveAttribute(
      'href',
      `/documents/${doc(60)}`,
    );
    expect(screen.getByRole('link', { name: 'Open Paperworks (24 public files)' })).toHaveAttribute(
      'href',
      '/orgs/jpice/paperworks',
    );
    const nav = screen.getAllByRole('navigation', { name: 'On this page' })[0]!;
    expect(nav).toHaveTextContent(/About.*Projects.*Documents.*Contact/);
    expect(screen.queryByRole('heading', { name: 'Fill in your page' })).toBeNull();
  });

  it('tells the own account what is left to fill in', async () => {
    stub(true);
    renderAt('/orgs/jpice');
    expect(await screen.findByRole('heading', { name: 'Fill in your page' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upload: Upload your Constitution & By-laws' })).toHaveAttribute(
      'href',
      '/dashboard/profile#constitution',
    );
  });
});
