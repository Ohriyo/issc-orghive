import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminOrganization, AdminOrganizationTree, AuthResponse } from '@orghive/shared';
import { routes } from '@/app/router';
import { authStore } from '@/lib/auth-store';
import { accountSession } from '@/test/accounts';
import { moved, toRows } from './presenters/use-admin-organizations';

const org = (slug: string, acronym: string, type: AdminOrganization['type'], active = true) => ({
  type,
  slug,
  acronym,
  name: `${acronym} full name`,
  description: null,
  logoUrl: null,
  active,
  documentCount: 4,
  hasAccount: true,
});

const TREE: AdminOrganizationTree = {
  issc: org('issc', 'ISSC', 'ISSC'),
  colleges: [
    {
      code: 'CAT',
      slug: 'cat',
      name: 'College of Agriculture and Technology',
      motto: null,
      description: null,
      csc: null,
      sbos: [],
    },
    {
      code: 'CEA',
      slug: 'cea',
      name: 'College of Engineering and Architecture',
      motto: null,
      description: null,
      csc: org('csc-cea', 'CSC-CEA', 'CSC'),
      sbos: [org('jpice', 'JPICE', 'SBO'), org('psme', 'PSME', 'SBO', false)],
    },
  ],
};

/** The ISSC account administers; any other organization's account does not. */
function session(admin: boolean): AuthResponse {
  return accountSession(admin ? 'issc' : 'own');
}

const fetchMock = vi.fn<typeof fetch>();
const calls: { method: string; path: string; body: unknown }[] = [];

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

function serve({ admin = true } = {}) {
  asAdmin = admin;
  fetchMock.mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, 'http://localhost').pathname.replace(/^\/api\/v1/, '');
    const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    calls.push({ method, path, body });
    if (path === '/auth/refresh') return json(session(admin));
    if (path === '/admin/organizations' && method === 'GET') return json(TREE);
    if (path === '/admin/organizations/psme/active') {
      return json({ ...TREE.colleges[1]!.sbos[1]!, active: true });
    }
    if (path === '/admin/organizations/jpice' && method === 'PATCH') {
      return json({ ...TREE.colleges[1]!.sbos[0]!, ...(body as object) });
    }
    if (path.endsWith('/order')) return json({});
    return json({ items: [] });
  });
}

let asAdmin = true;

function renderAt(url: string) {
  authStore.setSession(session(asAdmin));
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
  calls.length = 0;
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  authStore.reset();
});

describe('toRows', () => {
  const reorder = { colleges: vi.fn(), sbos: vi.fn() };
  const rows = toRows(TREE, reorder);

  it('puts the ISSC first, then each college heading its CSC and SBOs', () => {
    expect(rows.map((r) => `${r.kind}:${r.label}`)).toEqual([
      'issc:ISSC',
      'college:CAT',
      'college:CEA',
      'csc:CSC-CEA',
      'sbo:JPICE',
      'sbo:PSME',
    ]);
    expect(rows.find((r) => r.label === 'PSME')).toMatchObject({
      lastInGroup: true,
      active: false,
    });
    expect(rows.find((r) => r.label === 'CAT')!.adds).toEqual(['CSC']);
    expect(rows.find((r) => r.label === 'CEA')!.adds).toEqual(['SBO']);
  });

  it('moves colleges and SBOs within their own carousel only', () => {
    const cat = rows.find((r) => r.label === 'CAT')!;
    expect(cat.move).toMatchObject({ position: 1, of: 2, up: null });
    cat.move!.down!();
    expect(reorder.colleges).toHaveBeenCalledWith(['cea', 'cat']);
    rows.find((r) => r.label === 'PSME')!.move!.up!();
    expect(reorder.sbos).toHaveBeenCalledWith('cea', ['psme', 'jpice']);
    expect(rows.find((r) => r.label === 'CSC-CEA')!.move).toBeNull();
  });

  it('swaps neighbours', () => {
    expect(moved(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
  });
});

describe('/admin', () => {
  it('opens on Organizations with the hierarchy and the inactive state', async () => {
    serve();
    const router = renderAt('/admin');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Organizations' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/organizations');
    const rows = within(await screen.findByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(7); // header + 6
    expect(within(rows[6]!).getByText('Inactive')).toBeInTheDocument();
    expect(within(rows[6]!).getByRole('button', { name: 'Activate PSME' })).toBeInTheDocument();
  });

  it('tells a signed-in non-admin the tools are for ISSC admins, without loading them', async () => {
    serve({ admin: false });
    renderAt('/admin/organizations');
    expect(await screen.findByRole('heading', { name: 'Admins only' })).toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/admin'))).toBe(false);
  });

  it('saves a new carousel order', async () => {
    serve();
    renderAt('/admin/organizations');
    fireEvent.click(
      await within(await screen.findByRole('table')).findByRole('button', {
        name: 'Move CAT down',
      }),
    );
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PUT',
        path: '/admin/colleges/order',
        body: { slugs: ['cea', 'cat'] },
      }),
    );
  });

  it('reactivates an organization', async () => {
    serve();
    renderAt('/admin/organizations');
    fireEvent.click(
      await within(await screen.findByRole('table')).findByRole('button', {
        name: 'Activate PSME',
      }),
    );
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PUT',
        path: '/admin/organizations/psme/active',
        body: { active: true },
      }),
    );
  });

  it('edits an organization in the side sheet; its link name is fixed', async () => {
    serve();
    renderAt('/admin/organizations');
    fireEvent.click(
      await within(await screen.findByRole('table')).findByRole('button', { name: 'Edit JPICE' }),
    );
    const sheet = await screen.findByRole('dialog', { name: 'Edit JPICE' });
    expect(within(sheet).getByLabelText('Link name')).toBeDisabled();
    fireEvent.change(within(sheet).getByLabelText('Full name'), {
      target: { value: 'Junior Philippine Institute of Civil Engineers' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PATCH',
        path: '/admin/organizations/jpice',
        body: {
          acronym: 'JPICE',
          name: 'Junior Philippine Institute of Civil Engineers',
          description: null,
        },
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('suggests a link name from the short name for a new SBO', async () => {
    serve();
    renderAt('/admin/organizations');
    fireEvent.click(
      await within(await screen.findByRole('table')).findByRole('button', { name: /Add SBO/ }),
    );
    const sheet = await screen.findByRole('dialog', { name: 'Add an SBO to CEA' });
    fireEvent.change(within(sheet).getByLabelText('Short name'), { target: { value: 'ICpEP.SE' } });
    expect(within(sheet).getByLabelText('Link name')).toHaveValue('icpep-se');
  });
});
