import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthResponse } from '@orghive/shared';
import { routes } from '@/app/router';
import { authStore } from '@/lib/auth-store';
import { safeNext } from './presenters/use-auth';

const USER = {
  id: '0195f3c0-0000-7000-8000-000000000001',
  name: 'Juan Dela Cruz',
  email: 'juan@nwssu.test',
  mustChangePassword: false,
  roles: [],
};

function auth(overrides: Partial<typeof USER> = {}): AuthResponse {
  return { accessToken: 'access', expiresIn: 900, user: { ...USER, ...overrides } };
}

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
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

async function type(label: string, value: string) {
  fireEvent.change(await screen.findByLabelText(label), { target: { value } });
}

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  authStore.reset();
});

describe('protected routes', () => {
  it('shows a skeleton while the session is being checked', async () => {
    renderAt('/account');
    expect(await screen.findByText('Checking your session')).toBeInTheDocument();
  });

  it('sends a signed-out visitor to /login, remembering where they were going', async () => {
    authStore.clear();
    const router = renderAt('/account');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe('?next=%2Faccount');
  });

  it('holds a temporary password at /change-password', async () => {
    authStore.setSession(auth({ mustChangePassword: true }));
    const router = renderAt('/account');
    await waitFor(() => expect(router.state.location.pathname).toBe('/change-password'));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Choose your own password' }),
    ).toBeInTheDocument();
  });

  it('shows the account and signs out on the server', async () => {
    authStore.setSession(auth());
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    const router = renderAt('/account');

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(authStore.getSnapshot().status).toBe('anonymous');
  });
});

describe('/login', () => {
  beforeEach(() => authStore.clear());

  it('signs in, keeps the token in memory and continues to ?next=', async () => {
    fetchMock.mockImplementation(() => json(auth()));
    const router = renderAt('/login?next=%2Forgs%2Fjpice');

    await type('Email', 'Juan@NwSSU.test');
    await type('Password', 'correct horse battery');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/orgs/jpice'));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/auth/login');
    expect(JSON.parse(init!.body as string)).toEqual({
      email: 'juan@nwssu.test',
      password: 'correct horse battery',
    });
    expect(authStore.getAccessToken()).toBe('access');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('explains a wrong password and clears the password field', async () => {
    fetchMock.mockImplementation(() =>
      json(
        { error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } },
        401,
      ),
    );
    renderAt('/login');
    await type('Email', 'juan@nwssu.test');
    await type('Password', 'wrong password');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('validates before sending', async () => {
    renderAt('/login');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your password')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('/reset-password', () => {
  async function resetWith(password: string) {
    await type('New password', password);
    await type('Type it again', password);
    fireEvent.click(await screen.findByRole('button', { name: 'Save new password' }));
  }

  it('takes the token from the fragment and removes it from the address bar', async () => {
    const token = 'A'.repeat(43);
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    const router = renderAt(`/reset-password#token=${token}`);

    await type('New password', 'a brand new passphrase');
    await waitFor(() => expect(router.state.location.hash).toBe(''));
    expect(router.state.historyAction).toBe('REPLACE');
    await type('Type it again', 'a brand new passphrase');
    fireEvent.click(await screen.findByRole('button', { name: 'Save new password' }));

    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      token,
      newPassword: 'a brand new passphrase',
    });
  });

  it('starts fresh when a newer link is opened in the same tab', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    const router = renderAt(`/reset-password#token=${'A'.repeat(43)}`);
    await resetWith('a brand new passphrase');
    await screen.findByRole('heading', { name: 'Password changed' });

    await router.navigate(`/reset-password#token=${'B'.repeat(43)}`);
    await resetWith('another new passphrase');
    await screen.findByRole('heading', { name: 'Password changed' });
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toMatchObject({
      token: 'B'.repeat(43),
    });
  });

  it('explains a missing or malformed token instead of showing the form', async () => {
    renderAt('/reset-password#token=nope');
    expect(
      await screen.findByRole('heading', { name: 'This link no longer works' }),
    ).toBeInTheDocument();
  });
});

describe('safeNext', () => {
  it('keeps same-site paths and refuses ones that would leave the site', () => {
    expect(safeNext('/orgs/jpice?x=1')).toBe('/orgs/jpice?x=1');
    expect(safeNext('//evil.example')).toBe('/account');
    expect(safeNext('/\\evil.example')).toBe('/account');
    expect(safeNext('https://evil.example')).toBe('/account');
    expect(safeNext('/\t/evil.example')).toBe('/account');
    expect(safeNext('/\n/evil.example')).toBe('/account');
    expect(safeNext('/orgs/jpice paperworks')).toBe('/account');
    expect(safeNext(null)).toBe('/account');
  });
});
