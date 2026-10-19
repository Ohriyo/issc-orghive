import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Announcement,
  AnnouncementListResponse,
  AuthResponse,
  CollegeListResponse,
} from '@orghive/shared';
import { routes } from '@/app/router';
import { authStore } from '@/lib/auth-store';
import { excerptOf, toUpdateItem } from './presenters/update-format';
import { changesOf } from './presenters/use-update';
import { councilOptions } from './presenters/use-updates';

const ISSC = {
  type: 'ISSC' as const,
  slug: 'issc',
  acronym: 'ISSC',
  name: 'Institutional Supreme Student Council',
};
const CSC_CEA = { type: 'CSC' as const, slug: 'csc-cea', acronym: 'CSC-CEA', name: 'CSC of CEA' };
const UPDATE_ID = '0195f3c0-0000-7000-8000-0000000000e1';

function announcement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: UPDATE_ID,
    title: 'General assembly on Friday',
    body: 'All officers meet at the gym at 3 PM.\n\nBring your organization IDs.',
    publishedAt: '2026-10-17T02:00:00.000Z',
    editedAt: null,
    organization: ISSC,
    canEdit: false,
    ...overrides,
  };
}

const COLLEGES: CollegeListResponse = {
  colleges: [
    {
      code: 'CEA',
      slug: 'cea',
      name: 'College of Engineering and Architecture',
      motto: null,
      csc: { ...CSC_CEA, logoUrl: null, logoSrcSet: null },
    },
    { code: 'CAT', slug: 'cat', name: 'College of Agriculture', motto: null, csc: null },
  ],
};

function session(): AuthResponse {
  const orgId = '0195f3c0-0000-7000-8000-0000000000a1';
  return {
    accessToken: 'token',
    expiresIn: 900,
    user: {
      id: '0195f3c0-0000-7000-8000-000000000001',
      name: 'Andrea Cruz',
      email: 'president@orghive.test',
      mustChangePassword: false,
      organization: {
        id: orgId,
        type: 'ISSC',
        slug: 'issc',
        acronym: 'ISSC',
        name: 'ISSC',
        parentId: null,
      },
      officerInCharge: null,
    },
  };
}

const fetchMock = vi.fn<typeof fetch>();
const calls: { method: string; path: string; search: string; body: unknown }[] = [];

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

interface ServeOptions {
  signedIn?: boolean;
  detail?: Announcement | null;
  items?: Announcement[];
}

function serve({ signedIn = false, detail = announcement(), items }: ServeOptions = {}) {
  fetchMock.mockImplementation((input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, 'http://localhost');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, search: url.search, body });
    if (path === '/auth/refresh') {
      return signedIn
        ? json(session())
        : json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
    }
    if (path === '/colleges') return json(COLLEGES);
    if (path === '/organizations/issc') {
      return json({ ...ISSC, description: null, logoUrl: null, logoSrcSet: null, college: null });
    }
    if (path === '/announcements') {
      return json({
        items: items ?? [announcement({ canEdit: signedIn })],
        nextCursor: null,
        canPostFor: signedIn ? [ISSC] : [],
      } satisfies AnnouncementListResponse);
    }
    if (path === '/organizations/issc/announcements' && method === 'POST') {
      return json(announcement({ ...(body as object), canEdit: true }), 201);
    }
    if (path === `/announcements/${UPDATE_ID}`) {
      if (method === 'DELETE') return json(null, 204);
      if (method === 'PATCH') return json(announcement({ ...(body as object), canEdit: true }));
      return detail
        ? json(detail)
        : json({ error: { code: 'NOT_FOUND', message: 'Update not found' } }, 404);
    }
    return json({ items: [] });
  });
}

function renderAt(url: string, { signedIn = false } = {}) {
  if (signedIn) authStore.setSession(session());
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

describe('update formatting', () => {
  it('cuts the excerpt at a whole word', () => {
    expect(excerptOf('short text')).toBe('short text');
    const long = `${'word '.repeat(60)}end`;
    const cut = excerptOf(long, 50);
    expect(cut.endsWith('word…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(51);
  });

  it('splits the body into paragraphs and marks edits', () => {
    const item = toUpdateItem(announcement({ editedAt: '2026-10-18T03:00:00.000Z' }));
    expect(item.paragraphs).toEqual([
      'All officers meet at the gym at 3 PM.',
      'Bring your organization IDs.',
    ]);
    expect(item.excerpt).toBe('All officers meet at the gym at 3 PM.');
    expect(item.published).toBe('Oct 17, 2026');
    expect(item.edited).toBe('Edited Oct 18, 2026');
    expect(item.href).toBe(`/updates/${UPDATE_ID}`);
  });

  it('sends only what changed, and nothing when nothing did', () => {
    const before = { title: 'A title', body: 'Body' };
    expect(changesOf(before, { title: 'A title', body: 'Body' })).toBeNull();
    expect(changesOf(before, { title: 'New title', body: 'Body' })).toEqual({ title: 'New title' });
  });

  it('offers the ISSC, then each college CSC, as filters', () => {
    expect(councilOptions(ISSC, COLLEGES)).toEqual([
      { value: 'issc', label: 'ISSC' },
      { value: 'csc-cea', label: 'CSC-CEA' },
    ]);
  });
});

describe('/updates', () => {
  it('lists updates for signed-out visitors, without the post button', async () => {
    serve();
    renderAt('/updates');
    expect(await screen.findByRole('heading', { level: 1, name: 'Updates' })).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: 'General assembly on Friday' });
    expect(link).toHaveAttribute('href', `/updates/${UPDATE_ID}`);
    expect(screen.getByText('All officers meet at the gym at 3 PM.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Post an update/ })).not.toBeInTheDocument();
  });

  it('filters by council through the URL', async () => {
    serve();
    const router = renderAt('/updates');
    const select = await screen.findByLabelText('From');
    await within(select).findByRole('option', { name: 'CSC-CEA' });
    fireEvent.change(select, { target: { value: 'csc-cea' } });
    await waitFor(() => expect(router.state.location.search).toBe('?org=csc-cea'));
    await waitFor(() =>
      expect(
        calls.some((c) => c.path === '/announcements' && c.search.includes('org=csc-cea')),
      ).toBe(true),
    );
  });

  it('shows the empty state for a council with no updates', async () => {
    serve({ items: [] });
    renderAt('/updates?org=csc-cea');
    expect(await screen.findByText('No updates from CSC-CEA yet')).toBeInTheDocument();
  });

  it('lets a council officer publish an update', async () => {
    serve({ signedIn: true });
    renderAt('/updates', { signedIn: true });
    fireEvent.click(await screen.findByRole('button', { name: /Post an update/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Post an update' });
    // One council: no "From" choice.
    expect(within(sheet).queryByLabelText('From')).not.toBeInTheDocument();
    fireEvent.change(within(sheet).getByLabelText('Title'), {
      target: { value: 'Intramurals schedule' },
    });
    fireEvent.change(within(sheet).getByLabelText('Update'), {
      target: { value: 'Games start Monday.' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Publish' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'POST',
          path: '/organizations/issc/announcements',
          body: { title: 'Intramurals schedule', body: 'Games start Monday.' },
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps the sheet open and says what is missing', async () => {
    serve({ signedIn: true });
    renderAt('/updates', { signedIn: true });
    fireEvent.click(await screen.findByRole('button', { name: /Post an update/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Post an update' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Publish' }));
    expect(await within(sheet).findByText('Write the update')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

describe('/updates/:id', () => {
  it('shows the update in paragraphs, read-only for visitors', async () => {
    serve();
    renderAt(`/updates/${UPDATE_ID}`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'General assembly on Friday' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Bring your organization IDs.')).toBeInTheDocument();
    expect(screen.getByText(ISSC.name)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('says so when the update is gone', async () => {
    serve({ detail: null });
    renderAt(`/updates/${UPDATE_ID}`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Update not found' }),
    ).toBeInTheDocument();
  });

  it('lets its council edit it, sending only the changed field', async () => {
    serve({ signedIn: true, detail: announcement({ canEdit: true }) });
    renderAt(`/updates/${UPDATE_ID}`, { signedIn: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit update' });
    fireEvent.change(within(sheet).getByLabelText('Title'), {
      target: { value: 'General assembly moved to Saturday' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'PATCH',
          path: `/announcements/${UPDATE_ID}`,
          body: { title: 'General assembly moved to Saturday' },
        }),
      ),
    );
  });

  it('deletes after confirming, then returns to Updates', async () => {
    serve({ signedIn: true, detail: announcement({ canEdit: true }) });
    const router = renderAt(`/updates/${UPDATE_ID}`, { signedIn: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this update?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete update' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ method: 'DELETE', path: `/announcements/${UPDATE_ID}` }),
      ),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/updates'));
  });
});
