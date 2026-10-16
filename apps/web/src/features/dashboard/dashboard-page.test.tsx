import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AuthResponse,
  DashboardOrganization,
  DashboardResponse,
  DocumentSummary,
} from '@orghive/shared';
import { routes } from '@/app/router';
import { authStore } from '@/lib/auth-store';
import { activityLead, daysUntil, greetingFor, termOf } from './presenters/use-dashboard';
import { patchFor } from './presenters/use-my-documents';

const USER_ID = '0195f3c0-0000-7000-8000-000000000001';
const JPICE_ID = '0195f3c0-0000-7000-8000-0000000000a1';
const CSC_ID = '0195f3c0-0000-7000-8000-0000000000a2';
const DOC_ID = '0195f3c0-0000-7000-8000-0000000000d1';
const TYPE = { id: '0195f3c0-0000-7000-8000-0000000000e1', slug: 'resolution', name: 'Resolution' };

function session(): AuthResponse {
  return {
    accessToken: 'test-token',
    expiresIn: 900,
    user: {
      id: USER_ID,
      name: 'Juan Dela Cruz',
      email: 'juan@nwssu.test',
      mustChangePassword: false,
      roles: [{ orgId: JPICE_ID, role: 'officer', isHead: true }],
      memberships: [
        {
          orgId: JPICE_ID,
          orgSlug: 'jpice',
          orgAcronym: 'JPICE',
          role: 'officer',
          isHead: true,
          title: 'President',
        },
      ],
    },
  };
}

function doc(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id: DOC_ID,
    title: 'Resolution No. 2026-03: Officers’ Code of Conduct',
    description: null,
    academicYear: '2026-2027',
    semester: 'first',
    status: 'rejected',
    visibility: 'members',
    tags: [],
    submittedAt: '2026-10-10T00:00:00.000Z',
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-14T00:00:00.000Z',
    organization: {
      type: 'SBO',
      slug: 'jpice',
      acronym: 'JPICE',
      name: 'Junior Philippine Institute of Civil Engineers',
    },
    type: TYPE,
    currentVersion: null,
    ...overrides,
  };
}

function org(
  id: string,
  acronym: string,
  overrides: Partial<DashboardOrganization> = {},
): DashboardOrganization {
  return {
    organization: {
      id,
      type: 'SBO',
      slug: acronym.toLowerCase(),
      acronym,
      name: `${acronym} full name`,
      logoUrl: null,
      logoSrcSet: null,
    },
    counts: { draft: 1, pending: 2, approved: 24, rejected: 1, archived: 0 },
    recentDocuments: [doc()],
    needsRevision: [
      {
        document: doc(),
        remark: 'Attach the signed page from the minutes.',
        reviewerName: 'Maria Santos',
        decidedAt: '2026-10-14T03:00:00.000Z',
      },
    ],
    activity: [
      {
        id: '0195f3c0-0000-7000-8000-0000000000f1',
        kind: 'reject',
        at: '2026-10-14T03:00:00.000Z',
        actorName: 'Maria Santos',
        document: { id: DOC_ID, title: 'Resolution No. 2026-03: Officers’ Code of Conduct' },
        version: 1,
      },
    ],
    ...overrides,
  };
}

function dashboard(overrides: Partial<DashboardResponse> = {}): DashboardResponse {
  return {
    memberships: [
      {
        organizationId: JPICE_ID,
        role: 'officer',
        isHead: true,
        title: 'President',
        termEnd: '2027-07-31',
      },
    ],
    organizations: [org(JPICE_ID, 'JPICE')],
    reviews: null,
    isAdmin: false,
    ...overrides,
  };
}

const fetchMock = vi.fn<typeof fetch>();
const calls: { url: string; method: string }[] = [];

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

function serve(body: DashboardResponse, documents: DocumentSummary[] = [doc()]) {
  fetchMock.mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, method: init?.method ?? 'GET' });
    if (url.endsWith('/me/dashboard')) return json(body);
    if (url.endsWith('/document-types')) return json({ types: [TYPE] });
    if (url.includes('/organizations/jpice/documents')) {
      return json({ items: documents, nextCursor: null });
    }
    if (url.endsWith(`/documents/${DOC_ID}/archive`)) return json(doc({ status: 'archived' }));
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
  vi.stubGlobal('fetch', fetchMock);
  authStore.setSession(session());
});
afterEach(() => {
  fetchMock.mockReset();
  calls.length = 0;
  vi.unstubAllGlobals();
  authStore.reset();
  window.localStorage.clear();
});

describe('dashboard presenter helpers', () => {
  it('greets by the time of day with the first name', () => {
    expect(greetingFor('Juan Dela Cruz', new Date(2026, 9, 16, 9))).toBe('Good morning, Juan');
    expect(greetingFor('Maria', new Date(2026, 9, 16, 15))).toBe('Good afternoon, Maria');
    expect(greetingFor('Maria', new Date(2026, 9, 16, 20))).toBe('Good evening, Maria');
  });

  it('counts days to the last day of the term and flags under 14', () => {
    const today = new Date(2026, 9, 16, 15);
    expect(daysUntil('2026-10-16', today)).toBe(0);
    expect(daysUntil('2026-10-29', today)).toBe(13);
    const member = (termEnd: string | null) => ({
      organizationId: JPICE_ID,
      role: 'officer' as const,
      isHead: false,
      title: null,
      termEnd,
    });
    expect(termOf([member('2026-10-29')], today)).toMatchObject({ daysLeft: 13, endingSoon: true });
    expect(termOf([member('2026-10-30')], today)).toMatchObject({ endingSoon: false });
    // The latest of two terms counts; an open-ended one has no end.
    expect(termOf([member('2026-10-20'), member('2027-07-31')], today)?.endingSoon).toBe(false);
    expect(termOf([member(null)], today)).toBeNull();
  });

  it('words activity plainly', () => {
    const base = { id: 'x', at: '', document: null, actorName: 'Juan', version: 2 } as const;
    expect(activityLead({ ...base, kind: 'upload' })).toBe('Juan uploaded version 2 of');
    expect(activityLead({ ...base, kind: 'upload', version: 1 })).toBe('Juan uploaded');
    expect(activityLead({ ...base, kind: 'quarantine', actorName: null })).toBe(
      'The virus scan blocked version 2 of',
    );
  });

  it('sends only changed fields, and only visibility once a document is in review', () => {
    const values = {
      typeId: TYPE.id,
      title: 'New title',
      academicYear: '2026-2027',
      semester: undefined,
      visibility: 'public' as const,
      tags: [],
    };
    expect(patchFor(doc(), values)).toEqual({
      title: 'New title',
      semester: null,
      visibility: 'public',
    });
    expect(patchFor(doc({ status: 'approved' }), values)).toEqual({ visibility: 'public' });
    expect(patchFor(doc({ status: 'approved' }), { ...values, visibility: 'members' })).toBeNull();
  });
});

describe('/dashboard', () => {
  it(
    'shows the organization, its tiles, what needs attention and recent activity',
    // First test in the file: also loads the lazy route and the AppShell.
    { timeout: 15_000 },
    async () => {
      serve(dashboard());
      renderAt('/dashboard');

      expect(
        await screen.findByRole('heading', { level: 1, name: 'JPICE' }, { timeout: 5000 }),
      ).toBeInTheDocument();
      expect(screen.getByText('Officer, President')).toBeInTheDocument();
      expect(screen.getByText(/Term ends/)).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();

      const tiles = screen.getByRole('list', { name: 'Documents by status' });
      expect(
        within(tiles).getByRole('link', { name: 'Needs revision, 1 document' }),
      ).toHaveAttribute('href', '/dashboard/documents?org=jpice&status=rejected');
      expect(within(tiles).getAllByRole('link')).toHaveLength(4);

      expect(screen.getByText('“Attach the signed page from the minutes.”')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Revise: upload a new version/ }),
      ).toBeInTheDocument();
      expect(screen.getByText('Maria Santos rejected')).toBeInTheDocument();

      // Upload opens the upload flow for this organization (desktop header and phone bar).
      const uploads = screen.getAllByRole('link', { name: 'Upload document' });
      expect(uploads[0]).toHaveAttribute('href', '/orgs/jpice/paperworks/upload');
      expect(screen.getByRole('navigation', { name: 'JPICE actions' })).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/me/dashboard', expect.anything());
    },
  );

  it('switches organization and remembers the choice on this device', async () => {
    serve(
      dashboard({
        memberships: [
          {
            organizationId: JPICE_ID,
            role: 'officer',
            isHead: false,
            title: null,
            termEnd: '2027-07-31',
          },
          {
            organizationId: CSC_ID,
            role: 'officer',
            isHead: false,
            title: null,
            termEnd: '2027-07-31',
          },
        ],
        organizations: [org(JPICE_ID, 'JPICE'), org(CSC_ID, 'CSC-CEA')],
      }),
    );
    renderAt('/dashboard');
    const group = await screen.findByRole(
      'group',
      { name: 'Your organizations' },
      { timeout: 5000 },
    );
    fireEvent.click(within(group).getByRole('button', { name: /CSC-CEA/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'CSC-CEA' })).toBeInTheDocument();
    expect(window.localStorage.getItem(`orghive:dashboard:org:${USER_ID}`)).toBe(CSC_ID);
  });

  it('warns when the term ends within 14 days', async () => {
    const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    serve(
      dashboard({
        memberships: [
          { organizationId: JPICE_ID, role: 'officer', isHead: false, title: null, termEnd: soon },
        ],
      }),
    );
    renderAt('/dashboard');
    expect(await screen.findByRole('status', {}, { timeout: 5000 })).toHaveTextContent(
      /Your term ends in [45] days/,
    );
  });

  it('welcomes a new organization with no documents', async () => {
    const empty = org(JPICE_ID, 'JPICE', {
      counts: { draft: 0, pending: 0, approved: 0, rejected: 0, archived: 0 },
      recentDocuments: [],
      needsRevision: [],
      activity: [],
    });
    serve(dashboard({ organizations: [empty] }));
    renderAt('/dashboard');
    expect(
      await screen.findByRole(
        'heading',
        { name: 'Welcome to the JPICE workspace' },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Documents by status' })).not.toBeInTheDocument();
  });

  it('shows role panels only when the role applies', async () => {
    serve(dashboard({ reviews: { pending: 4, organizations: 6 }, isAdmin: true }));
    renderAt('/dashboard');
    expect(
      await screen.findByRole('link', { name: 'Open review queue' }, { timeout: 5000 }),
    ).toHaveAttribute('href', '/dashboard/reviews');
    expect(screen.getByRole('link', { name: 'Open admin' })).toHaveAttribute('href', '/admin');
  });

  it('hides upload and revise from an adviser', async () => {
    serve(
      dashboard({
        memberships: [
          {
            organizationId: JPICE_ID,
            role: 'adviser',
            isHead: false,
            title: 'Adviser',
            termEnd: '2027-07-31',
          },
        ],
      }),
    );
    renderAt('/dashboard');
    expect(await screen.findByText('Adviser', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Upload document' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Revise/ })).not.toBeInTheDocument();
  });

  it('explains what to do without an organization', async () => {
    serve(dashboard({ memberships: [], organizations: [] }));
    renderAt('/dashboard');
    expect(
      await screen.findByRole(
        'heading',
        { name: 'You’re not in an organization yet' },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
  });

  it('offers a retry when the dashboard fails to load', async () => {
    fetchMock.mockImplementation(() => json({ error: { code: 'INTERNAL', message: 'Boom' } }, 500));
    renderAt('/dashboard');
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(
      /could not be loaded/,
    );
  });

  it('sends /account to /dashboard', async () => {
    serve(dashboard());
    const router = renderAt('/account');
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
  });
});

describe('/dashboard/documents', () => {
  it('lists every status in tabs and archives an approved document', async () => {
    serve(dashboard(), [doc({ status: 'approved', title: 'Site visit report' })]);
    renderAt('/dashboard/documents?org=jpice');

    const tabs = await screen.findByRole('navigation', { name: 'Status' }, { timeout: 5000 });
    expect(within(tabs).getByRole('link', { name: /All\s*28/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(tabs).getByRole('link', { name: /Needs revision\s*1/ })).toHaveAttribute(
      'href',
      '/dashboard/documents?org=jpice&status=rejected',
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Archive: Site visit report' }));
    await waitFor(() =>
      expect(calls).toContainEqual({ url: `/api/v1/documents/${DOC_ID}/archive`, method: 'POST' }),
    );
  });

  it('asks the API for the chosen status', async () => {
    serve(dashboard(), [doc()]);
    renderAt('/dashboard/documents?org=jpice&status=rejected');
    expect(
      await screen.findByRole('button', { name: /Edit details/ }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(
      calls.some((c) => c.url.includes('/organizations/jpice/documents?limit=20&status=rejected')),
    ).toBe(true);
  });
});
