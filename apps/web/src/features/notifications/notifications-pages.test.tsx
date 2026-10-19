import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emailPreferences,
  type AuthResponse,
  type Notification,
  type NotificationListResponse,
} from '@orghive/shared';
import { routes } from '@/app/router';
import { authStore } from '@/lib/auth-store';
import { toCenterItem } from './presenters/use-notification-center';
import { toGroups } from './presenters/use-notification-settings';

const NOW = new Date('2026-10-18T06:00:00.000Z');
const PROJECT_ID = '0195f3c0-0000-7000-8000-0000000000c1';

function notification(n: number, overrides: Partial<Notification> = {}): Notification {
  return {
    id: `0195f3c0-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`,
    kind: 'deadline_soon',
    title: `Reminder ${n}`,
    body: 'The Project Proposal is due in 3 days.',
    link: `/projects/${PROJECT_ID}`,
    readAt: null,
    createdAt: new Date(NOW.getTime() - n * 3_600_000).toISOString(),
    ...overrides,
  };
}

function session(): AuthResponse {
  const orgId = '0195f3c0-0000-7000-8000-0000000000a1';
  return {
    accessToken: 'token',
    expiresIn: 900,
    user: {
      id: '0195f3c0-0000-7000-8000-000000000001',
      name: 'Andrea Cruz',
      email: 'andrea@nwssu.test',
      mustChangePassword: false,
      organization: {
        id: orgId,
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

const fetchMock = vi.fn<typeof fetch>();
const calls: { method: string; path: string; search: string; body: unknown }[] = [];
let failPut = false;
/** What the fake server remembers: the kinds with email off. */
let emailOff = new Set<string>();

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function serve() {
  fetchMock.mockImplementation((input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, 'http://localhost');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, search: url.search, body });
    if (path === '/auth/refresh') return json(session());
    if (path === '/me/notifications') {
      const unread = url.searchParams.get('unread') === 'true';
      const cursor = url.searchParams.get('cursor');
      const all = [
        notification(1),
        notification(2, { readAt: NOW.toISOString() }),
        notification(3),
      ];
      const list = unread ? all.filter((n) => !n.readAt) : all;
      const page: NotificationListResponse = cursor
        ? { items: list.slice(2), unreadCount: 2, nextCursor: null }
        : {
            items: list.slice(0, 2),
            unreadCount: 2,
            nextCursor: list.length > 2 ? list[1]!.id : null,
          };
      return json(page);
    }
    if (path.startsWith('/me/notifications/') || path === '/me/notifications/read-all') {
      return json(null, 204);
    }
    if (path === '/me/notification-preferences') {
      if (method === 'PUT') {
        if (failPut) return json({ error: { code: 'INTERNAL', message: 'Down' } }, 500);
        for (const [kind, on] of Object.entries(
          (body as { email: Record<string, boolean> }).email,
        )) {
          if (on) emailOff.delete(kind);
          else emailOff.add(kind);
        }
      }
      return json({ email: emailPreferences([...emailOff] as never) });
    }
    return json({ items: [] });
  });
}

function renderAt(url: string) {
  authStore.setSession(session());
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
  failPut = false;
  emailOff = new Set();
  vi.stubGlobal('fetch', fetchMock);
  serve();
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  authStore.reset();
});

describe('shaping', () => {
  it('labels each notification with its kind and a relative time', () => {
    const item = toCenterItem(notification(2), NOW, { open: vi.fn(), markRead: vi.fn() });
    expect(item).toMatchObject({
      kindLabel: 'Deadline reminders',
      when: '2 hours ago',
      unread: true,
      href: `/projects/${PROJECT_ID}`,
    });
  });

  it('groups every kind for the settings page, with its email state', () => {
    const toggle = vi.fn();
    const groups = toGroups({ email: emailPreferences(['term_ending']) }, toggle);
    expect(groups.map((g) => g.title)).toEqual([
      'Projects',
      'Appeals',
      'Files and reports',
      'Your organization',
    ]);
    const term = groups[3]!.rows.find((r) => r.kind === 'term_ending')!;
    expect(term.email).toBe(false);
    term.toggle(true);
    expect(toggle).toHaveBeenCalledWith('term_ending', true);
  });
});

describe('/dashboard/notifications', () => {
  it('lists notifications, pages on, and opens one (marking it read)', async () => {
    const router = renderAt('/dashboard/notifications');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Notifications' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('2 unread.')).toBeInTheDocument();
    const list = screen.getByRole('region', { name: 'Notifications' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(3));

    fireEvent.click(within(list).getByRole('button', { name: 'Reminder 1' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${PROJECT_ID}`));
    expect(calls).toContainEqual(
      expect.objectContaining({
        method: 'POST',
        path: `/me/notifications/${notification(1).id}/read`,
      }),
    );
  });

  it('shows only unread ones, and marks them read', async () => {
    const router = renderAt('/dashboard/notifications');
    fireEvent.click(await screen.findByRole('button', { name: 'Unread' }));
    await waitFor(() => expect(router.state.location.search).toBe('?show=unread'));
    await waitFor(() =>
      expect(
        calls.some((c) => c.path === '/me/notifications' && c.search.includes('unread=true')),
      ).toBe(true),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Mark "Reminder 3" read' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ method: 'POST', path: '/me/notifications/read-all' }),
      ),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({
        method: 'POST',
        path: `/me/notifications/${notification(3).id}/read`,
      }),
    );
  });

  it('links from the bell to the full list and the email settings', async () => {
    renderAt('/dashboard/notifications');
    const bell = await screen.findByRole('button', { name: /^Notifications, \d+ unread$/ });
    fireEvent.pointerDown(bell, { button: 0, pointerType: 'mouse' });
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'See all' })).toHaveAttribute(
      'href',
      '/dashboard/notifications',
    );
    expect(within(menu).getByRole('menuitem', { name: 'Email settings' })).toHaveAttribute(
      'href',
      '/dashboard/notifications/settings',
    );
  });
});

describe('/dashboard/notifications/settings', () => {
  it('shows every kind on by default and saves a switch at once', async () => {
    renderAt('/dashboard/notifications/settings');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Email settings' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('andrea@nwssu.test')).toBeInTheDocument();
    const updates = await screen.findByRole('switch', { name: 'Updates from your council' });
    expect(screen.getAllByRole('switch')).toHaveLength(8);
    expect(updates).toBeChecked();
    fireEvent.click(updates);
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'PUT',
          path: '/me/notification-preferences',
          body: { email: { announcement_posted: false } },
        }),
      ),
    );
    await waitFor(() => expect(updates).not.toBeChecked());
  });

  it('flips the switch back when saving fails', async () => {
    failPut = true;
    renderAt('/dashboard/notifications/settings');
    const term = await screen.findByRole('switch', { name: 'Term ending' });
    fireEvent.click(term);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    await waitFor(() => expect(term).toBeChecked());
    expect(await screen.findByText('The setting was not saved. Try again.')).toBeInTheDocument();
  });
});
