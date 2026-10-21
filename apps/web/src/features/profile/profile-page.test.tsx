import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardResponse, OrganizationProfile } from '@orghive/shared';
import { routes } from '@/app/router';
import { authStore } from '@/lib/auth-store';
import { accountSession, NO_COUNTS, TEST_ORGS } from '@/test/accounts';

const JPICE_ID = '0195f3c0-0000-7000-8000-0000000000a1';
const JPICE_ORG = { ...TEST_ORGS.jpice, id: JPICE_ID };

const DASHBOARD: DashboardResponse = {
  term: null,
  organizations: [
    {
      organization: {
        id: JPICE_ID,
        type: 'SBO',
        slug: 'jpice',
        acronym: 'JPICE',
        name: 'Junior Philippine Institute of Civil Engineers',
        logoUrl: null,
        logoSrcSet: null,
      },
      counts: NO_COUNTS,
      recentDocuments: [],
      quarantined: [],
      activity: [],
      semester: null,
    },
  ],
  isIssc: false,
  canSeeCompliance: false,
  decidesAppeals: false,
};

const PROFILE: OrganizationProfile = {
  slug: 'jpice',
  official: {
    name: 'Junior Philippine Institute of Civil Engineers',
    acronym: 'JPICE',
    type: 'SBO',
    college: { code: 'CEA', slug: 'cea', name: 'College of Engineering and Architecture' },
  },
  description: 'Civil engineering students.',
  mission: 'Shape competent civil engineers.',
  vision: null,
  contactEmail: null,
  facebookUrl: null,
  links: [],
  officers: [
    { position: 'President', name: 'Maria Clara Santos', isPublic: true },
    { position: 'Treasurer', name: 'Ben Cruz', isPublic: false },
  ],
  logoUrl: null,
  coverUrl: null,
  updatedAt: '2026-10-21T00:00:00.000Z',
};

const fetchMock = vi.fn<typeof fetch>();
const sent: { method: string; path: string; body: unknown }[] = [];

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

function serve() {
  fetchMock.mockImplementation((input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(raw, 'http://localhost').pathname.replace(/^\/api\/v1/, '');
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      sent.push({ method, path, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    }
    if (path === '/auth/refresh') return json(accountSession('own', JPICE_ORG));
    if (path === '/me/dashboard') return json(DASHBOARD);
    if (path === '/organizations/jpice/profile') return json(PROFILE);
    if (path === '/organizations/jpice/constitution') return json({ constitution: null });
    return json({ items: [] });
  });
}

function renderAt(url: string) {
  authStore.setSession(accountSession('own', JPICE_ORG));
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
  sent.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.clear();
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  authStore.reset();
});

describe('/dashboard/profile', () => {
  it('shows the official fields as read-only and the editable profile', async () => {
    serve();
    renderAt('/dashboard/profile');

    expect(await screen.findByRole('heading', { level: 1, name: 'JPICE profile' })).toBeInTheDocument();
    const official = screen.getByRole('region', { name: 'Official details' });
    expect(within(official).getByText('Managed by the ISSC. To change any of these, contact the ISSC.')).toBeInTheDocument();
    expect(within(official).queryByRole('textbox')).toBeNull();
    expect(screen.getByLabelText('Mission')).toHaveValue('Shape competent civil engineers.');
    expect(screen.getAllByRole('switch')[1]).toHaveAttribute('aria-checked', 'false');
    expect(
      await screen.findByText('Not uploaded yet. Your page says so until you add it.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('saves every field with who is acting, and goes back to the dashboard', async () => {
    serve();
    const router = renderAt('/dashboard/profile');
    const vision = await screen.findByLabelText('Vision');
    fireEvent.change(vision, { target: { value: 'Engineers who build for the public good.' } });
    fireEvent.change(screen.getByLabelText('Acting as'), { target: { value: 'Ana Reyes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add an officer' }));
    const positions = screen.getAllByLabelText('Position');
    fireEvent.change(positions[2]!, { target: { value: 'Secretary' } });
    fireEvent.change(screen.getAllByLabelText('Name')[2]!, { target: { value: 'Andrea Bonifacio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
    expect(sent).toEqual([
      {
        method: 'PUT',
        path: '/organizations/jpice/profile',
        body: {
          description: 'Civil engineering students.',
          mission: 'Shape competent civil engineers.',
          vision: 'Engineers who build for the public good.',
          contactEmail: null,
          facebookUrl: null,
          links: [],
          officers: [
            { position: 'President', name: 'Maria Clara Santos', isPublic: true },
            { position: 'Treasurer', name: 'Ben Cruz', isPublic: false },
            { position: 'Secretary', name: 'Andrea Bonifacio', isPublic: true },
          ],
          actingAs: 'Ana Reyes',
        },
      },
    ]);
  });

  it('asks for the officer acting before saving', async () => {
    serve();
    renderAt('/dashboard/profile');
    fireEvent.change(await screen.findByLabelText('Vision'), { target: { value: 'New vision.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('Enter your name in “Acting as” before saving.'),
    ).toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it('shows a field error from the shared rules without sending anything', async () => {
    serve();
    renderAt('/dashboard/profile');
    fireEvent.change(await screen.findByLabelText('Facebook page'), {
      target: { value: 'https://instagram.com/jpice' },
    });
    fireEvent.change(screen.getByLabelText('Acting as'), { target: { value: 'Ana Reyes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/Enter the link to a Facebook page/)).toBeInTheDocument();
    expect(sent).toEqual([]);
  });
});
