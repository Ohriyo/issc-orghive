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
      organization: {
        id: JPICE_ID,
        type: 'SBO',
        slug: 'jpice',
        acronym: 'JPICE',
        name: 'JPICE',
        parentId: null,
      },
      officerInCharge: null,
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
    status: 'available',
    visibility: 'governing',
    tags: [],
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
    counts: { public: 20, governing: 3, private: 1, scanning: 2, quarantined: 1, archived: 0 },
    recentDocuments: [doc()],
    quarantined: [doc({ status: 'quarantined' })],
    activity: [
      {
        id: '0195f3c0-0000-7000-8000-0000000000f1',
        kind: 'visibility_change',
        at: '2026-10-14T03:00:00.000Z',
        actorName: 'Maria Santos',
        document: { id: DOC_ID, title: 'Resolution No. 2026-03: Officers’ Code of Conduct' },
        version: 1,
      },
    ],
    semester: null,
    ...overrides,
  };
}

const OFFICER = { name: 'Juan Dela Cruz', position: 'President', email: 'juan@nwssu.test' };

function dashboard(overrides: Partial<DashboardResponse> = {}): DashboardResponse {
  return {
    term: { officerInCharge: OFFICER, termEnd: '2027-07-31' },
    organizations: [org(JPICE_ID, 'JPICE')],
    isIssc: false,
    canSeeCompliance: false,
    decidesAppeals: false,
    ...overrides,
  };
}

const fetchMock = vi.fn<typeof fetch>();
const calls: { url: string; method: string; body?: object }[] = [];

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

function serve(body: DashboardResponse, documents: DocumentSummary[] = [doc()]) {
  fetchMock.mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const sent = typeof init?.body === 'string' ? (JSON.parse(init.body) as object) : undefined;
    calls.push({ url, method: init?.method ?? 'GET', body: sent });
    if (url.endsWith(`/documents/${DOC_ID}/visibility`)) {
      return json(doc({ ...(sent as Partial<DocumentSummary>) }));
    }
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
    const term = (termEnd: string | null) => ({ officerInCharge: OFFICER, termEnd });
    expect(termOf(term('2026-10-29'), today)).toMatchObject({ daysLeft: 13, endingSoon: true });
    expect(termOf(term('2026-10-30'), today)).toMatchObject({ endingSoon: false });
    // An open-ended term, or no term at all, has no end.
    expect(termOf(term(null), today)).toBeNull();
    expect(termOf(null, today)).toBeNull();
  });

  it('words activity plainly', () => {
    const base = { id: 'x', at: '', document: null, actorName: 'Juan', version: 2 } as const;
    expect(activityLead({ ...base, kind: 'upload' })).toBe('Juan uploaded version 2 of');
    expect(activityLead({ ...base, kind: 'upload', version: 1 })).toBe('Juan uploaded');
    expect(activityLead({ ...base, kind: 'quarantine', actorName: null })).toBe(
      'The virus scan blocked version 2 of',
    );
    expect(activityLead({ ...base, kind: 'visibility_change' })).toBe('Juan changed who can see');
  });

  it('sends only changed details, never visibility (it has its own endpoint)', () => {
    const values = {
      typeId: TYPE.id,
      title: 'New title',
      academicYear: '2026-2027',
      semester: undefined,
      visibility: 'public' as const,
      tags: [],
    };
    expect(patchFor(doc(), values)).toEqual({ title: 'New title', semester: null });
    expect(
      patchFor(doc(), { ...values, title: doc().title, semester: 'first', visibility: 'private' }),
    ).toBeNull();
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
      expect(screen.getByText('Juan Dela Cruz, President')).toBeInTheDocument();
      expect(screen.getByText(/Term ends/)).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();

      const tiles = screen.getByRole('list', { name: 'Documents by who can see them' });
      expect(within(tiles).getByRole('link', { name: 'Public, 20 documents' })).toHaveAttribute(
        'href',
        '/dashboard/documents?org=jpice&status=available&visibility=public',
      );
      expect(
        within(tiles).getByRole('link', { name: 'Blocked by scan, 1 document' }),
      ).toHaveAttribute('href', '/dashboard/documents?org=jpice&status=quarantined');
      expect(within(tiles).getAllByRole('link')).toHaveLength(4);

      expect(
        screen.getByRole('button', { name: /Upload a clean copy: of Resolution/ }),
      ).toBeInTheDocument();
      expect(screen.getByText('Maria Santos changed who can see')).toBeInTheDocument();
      // Nothing waits for a review.
      expect(screen.queryByText(/review/i)).not.toBeInTheDocument();

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
        term: { officerInCharge: OFFICER, termEnd: soon },
      }),
    );
    renderAt('/dashboard');
    expect(await screen.findByRole('status', {}, { timeout: 5000 })).toHaveTextContent(
      /This officer term ends in [45] days/,
    );
  });

  it('welcomes a new organization with no documents', async () => {
    const empty = org(JPICE_ID, 'JPICE', {
      counts: { public: 0, governing: 0, private: 0, scanning: 0, quarantined: 0, archived: 0 },
      recentDocuments: [],
      quarantined: [],
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
    expect(
      screen.queryByRole('list', { name: 'Documents by who can see them' }),
    ).not.toBeInTheDocument();
  });

  it('shows the admin panel only to the ISSC account, and no review queue to anyone', async () => {
    serve(dashboard({ isIssc: true }));
    renderAt('/dashboard');
    expect(
      await screen.findByRole('link', { name: 'Open admin' }, { timeout: 5000 }),
    ).toHaveAttribute('href', '/admin');
    expect(screen.queryByRole('link', { name: /review/i })).not.toBeInTheDocument();
  });

  it('links councils to the compliance overview', async () => {
    serve(dashboard({ canSeeCompliance: true }));
    renderAt('/dashboard');
    expect(
      await screen.findByRole('link', { name: 'Open overview' }, { timeout: 5000 }),
    ).toHaveAttribute('href', '/dashboard/compliance');
  });

  it("shows an officer this semester's projects and next deadlines", async () => {
    const dueAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    serve(
      dashboard({
        organizations: [
          org(JPICE_ID, 'JPICE', {
            semester: {
              academicYear: '2026-2027',
              semester: 'first',
              counts: { active: 2, blocked: 1, completed: 0 },
              nextDeadlines: [
                {
                  projectId: '0195f3c0-0000-7000-8000-0000000000c1',
                  projectName: 'Bridge contest',
                  task: 'PROPOSAL',
                  dueAt,
                },
              ],
            },
          }),
        ],
      }),
    );
    renderAt('/dashboard');
    const section = (
      await screen.findByRole('heading', { name: 'This semester' }, { timeout: 5000 })
    ).closest('section')!;
    expect(within(section).getByText('1st semester, 2026-2027')).toBeInTheDocument();
    expect(within(section).getByText('Blocked').nextSibling).toHaveTextContent('1');
    expect(within(section).getByText('Project Proposal')).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: 'Bridge contest' })).toHaveAttribute(
      'href',
      '/projects/0195f3c0-0000-7000-8000-0000000000c1',
    );
  });

  it('leaves "This semester" out where the user is not an officer', async () => {
    serve(dashboard());
    renderAt('/dashboard');
    await screen.findByRole('heading', { level: 1 }, { timeout: 5000 });
    expect(screen.queryByRole('heading', { name: 'This semester' })).not.toBeInTheDocument();
  });

  it('explains what to do without an organization', async () => {
    serve(dashboard({ term: null, organizations: [] }));
    renderAt('/dashboard');
    expect(
      await screen.findByRole(
        'heading',
        { name: 'This account has no organization' },
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
  it('lists the lifecycle in tabs and archives an available document', async () => {
    serve(dashboard(), [doc({ title: 'Site visit report' })]);
    renderAt('/dashboard/documents?org=jpice');

    const tabs = await screen.findByRole('navigation', { name: 'Status' }, { timeout: 5000 });
    expect(within(tabs).getByRole('link', { name: /All\s*27/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(tabs).getByRole('link', { name: /Available\s*24/ })).toHaveAttribute(
      'href',
      '/dashboard/documents?org=jpice&status=available',
    );
    expect(within(tabs).getByRole('link', { name: /Blocked by scan\s*1/ })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Archive: Site visit report' }));
    await waitFor(() =>
      expect(calls).toContainEqual({ url: `/api/v1/documents/${DOC_ID}/archive`, method: 'POST' }),
    );
  });

  it('asks the API for the chosen status and visibility, and can clear the visibility', async () => {
    serve(dashboard(), [doc()]);
    renderAt('/dashboard/documents?org=jpice&status=available&visibility=governing');
    expect(
      await screen.findByRole('button', { name: /Edit details/ }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(
      calls.some((c) =>
        c.url.includes(
          '/organizations/jpice/documents?limit=20&status=available&visibility=governing',
        ),
      ),
    ).toBe(true);
    expect(screen.getByText(/Showing only: Governing bodies/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show every visibility' })).toHaveAttribute(
      'href',
      '/dashboard/documents?org=jpice&status=available',
    );
  });

  it('lets an officer change who can see a document in one step', async () => {
    serve(dashboard(), [doc({ title: 'Site visit report' })]);
    renderAt('/dashboard/documents?org=jpice');
    const select = await screen.findByRole(
      'combobox',
      { name: 'Who can see it: Site visit report' },
      { timeout: 5000 },
    );
    expect(select).toHaveValue('governing');
    fireEvent.change(select, { target: { value: 'private' } });
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: `/api/v1/documents/${DOC_ID}/visibility`,
        method: 'PATCH',
        body: { visibility: 'private' },
      }),
    );
  });
});
