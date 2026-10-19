import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AuthResponse,
  AuthUser,
  SystemAuditListResponse,
  SystemOverview,
  SystemSecurity,
  SystemUser,
} from '@orghive/shared';
import { routes } from '@/app/router';
import { landingFor } from '@/features/auth/presenters/use-auth';
import { authStore } from '@/lib/auth-store';
import { TEST_ORGS } from '@/test/accounts';

const ME = '0195f3c0-0000-7000-8000-000000000001';
const STUDENT = '0195f3c0-0000-7000-8000-000000000002';
const NOW = '2026-10-19T08:00:00.000Z';

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: ME,
    name: 'Dev Super',
    email: 'dev@orghive.test',
    mustChangePassword: false,
    organization: null,
    officerInCharge: null,
    systemRole: 'SUPER_ADMIN',
    mfaSetupRequired: false,
    ...overrides,
  };
}

const session = (overrides: Partial<AuthUser> = {}): AuthResponse => ({
  accessToken: 'token',
  expiresIn: 900,
  user: user(overrides),
});

const OVERVIEW: SystemOverview = {
  users: { total: 12, active: 10, disabled: 2 },
  superAdmins: { active: 1, pendingMfa: 0 },
  organizations: { total: 9, active: 8 },
  documents: { available: 40, scanning: 1, stuckScanning: 1, quarantined: 0, archived: 3 },
  queues: [{ name: 'documents', waiting: 0, active: 0, delayed: 0, failed: 2 }],
  auditEventsLast24h: 120,
  failedLoginsLast24h: 3,
  generatedAt: NOW,
};

const studentRow: SystemUser = {
  id: STUDENT,
  name: 'Ana Reyes',
  email: 'ana@orghive.test',
  systemRole: 'NONE',
  mfaEnabledAt: null,
  disabledAt: null,
  organization: { slug: 'jpice', acronym: 'JPICE', type: 'SBO' },
  createdAt: NOW,
};

const AUDIT: SystemAuditListResponse = {
  items: [
    {
      id: '0195f3c0-0000-7000-8000-0000000000a9',
      createdAt: NOW,
      action: 'user_deactivate',
      actor: { id: ME, name: 'Dev Super', email: 'dev@orghive.test' },
      entityType: 'user',
      entityId: STUDENT,
      organizationId: null,
      ip: '203.0.113.9',
      userAgent: 'Firefox',
      actingAs: null,
      metadata: { before: { disabledAt: null }, after: { disabledAt: NOW } },
    },
    {
      id: '0195f3c0-0000-7000-8000-0000000000aa',
      createdAt: NOW,
      action: 'upload',
      actor: { id: STUDENT, name: 'JPICE', email: 'jpice@orghive.test' },
      entityType: 'document',
      entityId: '0195f3c0-0000-7000-8000-0000000000d1',
      organizationId: '0195f3c0-0000-7000-8000-0000000000a1',
      ip: '203.0.113.10',
      userAgent: null,
      actingAs: 'Juan Dela Cruz',
      metadata: { version: 1 },
    },
  ],
  nextCursor: null,
};

const SECURITY: SystemSecurity = {
  mfaEnabledAt: NOW,
  recoveryCodesRemaining: 2,
  sessionStartedAt: NOW,
  sessionExpiresAt: '2026-10-19T16:00:00.000Z',
  idleTimeoutSeconds: 900,
  stepUpExpiresAt: null,
};

const CODES = Array.from({ length: 10 }, (_, i) => `abcd${i}-efgh${i}`);

const fetchMock = vi.fn<typeof fetch>();
const calls: { method: string; path: string; body: unknown }[] = [];
let stepUpDone = false;

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}
const stepUpRequired = () =>
  json({ error: { code: 'STEP_UP_REQUIRED', message: 'Enter a code to confirm' } }, 403);

function serve(refresh: AuthResponse = session()) {
  fetchMock.mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, 'http://localhost').pathname.replace(/^\/api\/v1/, '');
    const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    calls.push({ method, path, body });
    if (path === '/auth/refresh') return json(refresh);
    if (path === '/system/overview') return json(OVERVIEW);
    if (path === '/system/users' && method === 'GET') {
      return json({ items: [studentRow], nextCursor: null });
    }
    if (path === `/system/users/${STUDENT}/status`) {
      return stepUpDone ? json({ ...studentRow, disabledAt: NOW }) : stepUpRequired();
    }
    if (path === '/system/step-up') {
      stepUpDone = true;
      return json({ stepUpExpiresAt: NOW });
    }
    if (path === '/system/audit-logs') return json(AUDIT);
    if (path === '/system/me/security') return json(SECURITY);
    if (path === '/system/me/recovery-codes') {
      return stepUpDone ? json({ recoveryCodes: CODES }) : stepUpRequired();
    }
    if (path === '/auth/login') {
      return json({ mfaRequired: true, challengeToken: 'c'.repeat(43), expiresIn: 300 });
    }
    if (path === '/auth/mfa/verify') return json(session());
    if (path === '/auth/mfa/setup') return json({ ...session(), recoveryCodes: CODES });
    return json({ items: [], unreadCount: 0, nextCursor: null });
  });
}

function renderAt(url: string, signedIn: AuthResponse | null = session()) {
  if (signedIn) authStore.setSession(signedIn);
  else authStore.clear();
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
  stepUpDone = false;
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  authStore.reset();
});

describe('landingFor', () => {
  it('sends pending MFA to setup, a console-only super admin to /system, others to the dashboard', () => {
    expect(landingFor(user({ mfaSetupRequired: true }), '/system/audit')).toBe('/mfa-setup');
    expect(landingFor(user(), null)).toBe('/system');
    expect(landingFor(user(), '/system/audit')).toBe('/system/audit');
    const jpice = user({ systemRole: 'NONE', organization: TEST_ORGS.jpice });
    expect(landingFor(jpice, null)).toBe('/dashboard');
  });
});

describe('/system', () => {
  it('opens on the overview, flagging what needs a look', async () => {
    serve();
    const router = renderAt('/system');
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/system/overview');
    expect(await screen.findByText('Stuck scanning (15+ min)')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'System console' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Documents 0 0 0 2/ })).toBeInTheDocument();
  });

  it('tells anyone who is not a super admin that the console is not for them', async () => {
    serve(session({ systemRole: 'NONE' }));
    renderAt('/system/overview', session({ systemRole: 'NONE' }));
    expect(await screen.findByRole('heading', { name: 'Super admins only' })).toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/system'))).toBe(false);
  });

  it('holds a super admin without MFA at /mfa-setup', async () => {
    serve(session({ mfaSetupRequired: true }));
    const router = renderAt('/system/users', session({ mfaSetupRequired: true }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/mfa-setup'));
  });

  it('confirms a deactivation, asks for a step-up code, then retries it', async () => {
    serve();
    renderAt('/system/users');
    const table = await screen.findByRole('table', { name: 'User accounts' });
    fireEvent.click(within(table).getByRole('button', { name: 'Deactivate: Ana Reyes' }));

    const confirm = await screen.findByRole('alertdialog', { name: 'Deactivate Ana Reyes?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Deactivate' }));

    const stepUp = await screen.findByRole('dialog', { name: 'Confirm it’s you' });
    fireEvent.change(within(stepUp).getByLabelText('Authentication code'), {
      target: { value: '123 456' },
    });
    fireEvent.click(within(stepUp).getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(
        calls.filter((c) => c.path === `/system/users/${STUDENT}/status`).map((c) => c.body),
      ).toEqual([{ active: false }, { active: false }]),
    );
    expect(calls.find((c) => c.path === '/system/step-up')?.body).toEqual({ code: '123456' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('lists audit events with their details', async () => {
    serve();
    renderAt('/system/audit');
    const events = await screen.findByRole('list', { name: 'Audit events' });
    expect(within(events).getByText('User deactivate')).toBeInTheDocument();
    expect(within(events).getByText('Dev Super (dev@orghive.test)')).toBeInTheDocument();
    expect(within(events).getByText(/"after"/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'login_failed' } });
    await waitFor(() => expect(calls.some((c) => c.path === '/system/audit-logs')).toBe(true));
  });

  it('shows who acted for a shared account, and filters by that name', async () => {
    serve();
    renderAt('/system/audit');
    const events = await screen.findByRole('list', { name: 'Audit events' });
    expect(within(events).getByText('acting as Juan Dela Cruz')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Acting as' }), {
      target: { value: ' dela cruz ' },
    });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input]) =>
            typeof input === 'string' && input.includes('/system/audit-logs?actingAs=dela+cruz'),
        ),
      ).toBe(true),
    );
  });

  it('issues new recovery codes after a step-up, and shows them once', async () => {
    serve();
    renderAt('/system/security');
    expect(await screen.findByText('2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Issue new recovery codes' }));

    const stepUp = await screen.findByRole('dialog');
    fireEvent.change(within(stepUp).getByLabelText('Authentication code'), {
      target: { value: '654321' },
    });
    fireEvent.click(within(stepUp).getByRole('button', { name: 'Confirm' }));

    const list = await screen.findByRole('list', { name: 'Recovery codes' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
  });
});

describe('super admin sign-in', () => {
  it('asks for the authenticator code after the password, then opens /system', async () => {
    serve();
    const router = renderAt('/login', null);
    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'dev@orghive.test' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a long passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const code = await screen.findByLabelText('Authentication code');
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/system/overview'));
    expect(calls.find((c) => c.path === '/auth/mfa/verify')?.body).toEqual({
      challengeToken: 'c'.repeat(43),
      code: '123456',
    });
  });

  it('switches the second step to a recovery code, and back to the password', async () => {
    serve();
    renderAt('/login', null);
    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'dev@orghive.test' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a long passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Use a recovery code' }));
    expect(screen.getByLabelText('Recovery code')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to email and password' }));
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
  });

  it('confirms the authenticator at /mfa-setup and shows the recovery codes before the console', async () => {
    serve(session({ mfaSetupRequired: true }));
    const router = renderAt('/mfa-setup', session({ mfaSetupRequired: true }));
    fireEvent.change(await screen.findByLabelText('Authentication code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    const list = await screen.findByRole('list', { name: 'Recovery codes' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: 'I saved them. Open the console' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/system/overview'));
  });
});
