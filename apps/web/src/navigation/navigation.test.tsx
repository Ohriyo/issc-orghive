import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, Link, RouterProvider, type InitialEntry } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/app/router';
import { authStore } from '@/lib/auth-store';
import { readOrigin } from './origin';
import { chrome } from './trails';
import { ConfirmLeaveDialog } from './unsaved-changes-dialog';
import { useBackNavigation } from './use-back-navigation';
import type * as Sonner from 'sonner';

type SonnerModule = typeof Sonner;
import { useUnsavedChangesGuard } from './use-unsaved-changes';

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock('sonner', async (original) => ({
  ...(await original<SonnerModule>()),
  toast: { success: toastSuccess },
}));

const DASHBOARD = { path: '/dashboard', label: 'Dashboard' };

/** Renders `element` at `entry` in a memory router, plus a catch-all showing the path. */
function renderAt(entry: InitialEntry, element: React.ReactNode) {
  const router = createMemoryRouter(
    [
      { path: '/form', element },
      { path: '*', element: <p>somewhere else</p> },
    ],
    { initialEntries: ['/start', entry] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

function Probe() {
  const back = useBackNavigation(DASHBOARD);
  return (
    <>
      <p>
        {back.target?.path}|{back.target?.label}|{String(back.fromOrigin)}
      </p>
      <button type="button" onClick={() => back.finish('Saved.')}>
        Done
      </button>
    </>
  );
}

const withOrigin = (from: unknown): InitialEntry => ({ pathname: '/form', state: { from } });

describe('useBackNavigation', () => {
  afterEach(() => toastSuccess.mockReset());

  it('goes back to the page the user came from', () => {
    renderAt(
      withOrigin({ path: '/orgs/jpice/paperworks?type=x', label: 'JPICE Paperworks' }),
      <Probe />,
    );
    expect(
      screen.getByText('/orgs/jpice/paperworks?type=x|JPICE Paperworks|true'),
    ).toBeInTheDocument();
  });

  it('falls back to the logical parent after a direct link or a refresh', () => {
    renderAt('/form', <Probe />);
    expect(screen.getByText('/dashboard|Dashboard|false')).toBeInTheDocument();
  });

  it('ignores an origin that is another site, malformed or the page itself', () => {
    for (const from of [
      { path: '//evil.example', label: 'x' },
      { path: 'https://evil.example/', label: 'x' },
      { path: '/\\evil.example', label: 'x' },
      { path: '/dashboard', label: '' },
      'not an object',
      { path: '/form?step=2', label: 'Same page' },
    ]) {
      expect(readOrigin({ from }, { pathname: '/form' })).toBeNull();
    }
  });

  it('after a successful submit, returns to the origin with replace and a toast', async () => {
    const router = renderAt(withOrigin({ path: '/dashboard', label: 'Dashboard' }), <Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(toastSuccess).toHaveBeenCalledWith('Saved.');
    // The finished form was replaced: one step back is the page before it, not the form.
    await router.navigate(-1);
    expect(router.state.location.pathname).toBe('/start');
  });
});

function GuardedForm() {
  const [dirty, setDirty] = useState(false);
  const guard = useUnsavedChangesGuard(dirty);
  return (
    <>
      <button type="button" onClick={() => setDirty(true)}>
        Type something
      </button>
      <Link to="/elsewhere">Leave page</Link>
      <ConfirmLeaveDialog
        open={guard.blocker.state === 'blocked'}
        onStay={() => guard.blocker.reset?.()}
        onLeave={() => guard.blocker.proceed?.()}
      />
    </>
  );
}

describe('useUnsavedChangesGuard', () => {
  it('lets a clean form go, and asks before leaving unsaved changes', async () => {
    const clean = renderAt('/form', <GuardedForm />);
    fireEvent.click(screen.getByRole('link', { name: 'Leave page' }));
    await waitFor(() => expect(clean.state.location.pathname).toBe('/elsewhere'));
  });

  it('keeps the user on the page when they choose to stay, and lets them leave', async () => {
    const router = renderAt('/form', <GuardedForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Type something' }));
    fireEvent.click(screen.getByRole('link', { name: 'Leave page' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave without saving?' });
    fireEvent.click(screen.getByRole('button', { name: 'Stay on this page' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe('/form');

    fireEvent.click(screen.getByRole('link', { name: 'Leave page' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/elsewhere'));
  });
});

describe('logical parents (Back without an origin)', () => {
  const jpice = {
    slug: 'jpice',
    acronym: 'JPICE',
    type: 'SBO' as const,
    college: { code: 'CEA', slug: 'cea' },
  };

  it('workspace screens go to the Dashboard', () => {
    expect(chrome.workspace('Upload', jpice).parent).toEqual(DASHBOARD);
    expect(chrome.workspace('JPICE documents').parent).toEqual(DASHBOARD);
    expect(chrome.workspace('Upload', jpice).trail.map((c) => c.label)).toEqual([
      'Dashboard',
      'JPICE',
      'Upload',
    ]);
  });

  it('projects hang off the Dashboard; a project and New project go to the project list', () => {
    const list = { path: '/dashboard/projects?org=jpice', label: 'JPICE projects' };
    expect(chrome.projects(jpice).parent).toEqual(DASHBOARD);
    expect(chrome.newProject(jpice).parent).toEqual(list);
    expect(chrome.project(jpice, 'Bridge competition').parent).toEqual(list);
    expect(chrome.project(jpice, 'Bridge competition').trail.map((c) => c.label)).toEqual([
      'Dashboard',
      'JPICE projects',
      'Bridge competition',
    ]);
    // Before the project has loaded: still a sensible way back.
    expect(chrome.project(null, null).parent).toEqual({
      path: '/dashboard/projects',
      label: 'Projects',
    });
  });

  it('a document goes to its Paperworks; Paperworks to the organization', () => {
    expect(chrome.document(jpice, 'Report').parent).toEqual({
      path: '/orgs/jpice/paperworks',
      label: 'JPICE Paperworks',
    });
    expect(chrome.paperworks('jpice', jpice).parent).toEqual({
      path: '/orgs/jpice',
      label: 'JPICE',
    });
    expect(chrome.document(jpice, 'Report').trail.map((c) => c.label)).toEqual([
      'Home',
      'CEA',
      'JPICE',
      'Paperworks',
      'Report',
    ]);
  });

  it('an organization goes to its college, a college to /colleges, /colleges home', () => {
    expect(chrome.organization('jpice', jpice).parent).toEqual({
      path: '/colleges/cea',
      label: 'CEA',
    });
    expect(
      chrome.organization('issc', { slug: 'issc', acronym: 'ISSC', type: 'ISSC', college: null })
        .parent,
    ).toEqual({ path: '/', label: 'Home' });
    expect(chrome.college({ code: 'CEA', slug: 'cea' }).parent).toEqual({
      path: '/colleges',
      label: 'Colleges',
    });
    expect(chrome.colleges().parent).toEqual({ path: '/', label: 'Home' });
  });
});

/** Every route the app has, signed out and signed in. */
const ROUTES = [
  '/',
  '/colleges',
  '/colleges/cea',
  '/colleges/cea/organizations',
  '/orgs/jpice',
  '/orgs/jpice/paperworks',
  '/orgs/jpice/paperworks/upload',
  '/orgs/jpice/upload',
  '/documents/0195f3c0-0000-7000-8000-0000000000d1',
  '/dashboard',
  '/dashboard/documents',
  '/dashboard/projects',
  '/dashboard/projects/new',
  '/projects/0195f3c0-0000-7000-8000-0000000000c1',
  '/admin',
  '/login',
  '/forgot-password',
  '/reset-password',
  '/change-password',
  '/account',
  '/no-such-page',
];

describe('AppShell', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    // Every API call fails: pages show their error or not-found states, the header stays.
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    authStore.reset();
  });

  it.each(ROUTES)('renders the header on %s', { timeout: 15_000 }, async (path) => {
    authStore.clear();
    const router = createMemoryRouter(routes, { initialEntries: [path] });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('banner', {}, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Orghive home' })).toHaveAttribute('href', '/');
    expect(document.getElementById('content')).not.toBeNull();
  });
});
