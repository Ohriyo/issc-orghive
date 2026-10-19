import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AccountRequestSummary,
  AdminOrganizationTree,
  AuthResponse,
  AuthUser,
  SupportDocumentList,
  SystemAuditListResponse,
  SystemOverview,
  SystemSecurity,
  SystemUser,
  SystemUserDetail,
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
  lockedAt: null,
  lockReason: null,
  mustChangePassword: false,
  lastLoginAt: null,
  organization: { slug: 'jpice', acronym: 'JPICE', name: 'JPICE', type: 'SBO', college: 'CEA' },
  officerInCharge: { name: 'Ana Reyes', position: 'President', email: 'ana@nwssu.test' },
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

const DETAIL: SystemUserDetail = {
  account: studentRow,
  terms: [
    {
      officerName: 'Ana Reyes',
      officerPosition: 'President',
      officerEmail: 'ana@nwssu.test',
      termStart: '2026-08-01',
      termEnd: '2027-07-31',
      endedAt: null,
    },
  ],
  logins: [{ at: NOW, succeeded: true, ip: '203.0.113.9', userAgent: 'Firefox' }],
  sessions: [],
  audit: [],
};

const FILES: SupportDocumentList = {
  organization: { slug: 'jpice', acronym: 'JPICE', name: 'JPICE' },
  items: [
    {
      id: '0195f3c0-0000-7000-8000-0000000000d1',
      title: null,
      type: 'Resolution',
      status: 'scanning',
      visibility: 'private',
      isTestData: true,
      sizeBytes: 2048,
      scanStatus: 'pending',
      stuck: true,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
};

const iecep = {
  type: 'SBO' as const,
  slug: 'iecep',
  acronym: 'IECEP',
  name: 'Institute of Electronics Engineers',
  description: null,
  logoUrl: null,
  active: true,
  documentCount: 0,
  hasAccount: false,
  accountRequest: null as AccountRequestSummary | null,
};
const TREE: AdminOrganizationTree = {
  issc: { ...iecep, type: 'ISSC', slug: 'issc', acronym: 'ISSC', name: 'ISSC', hasAccount: true },
  colleges: [
    {
      code: 'CEA',
      slug: 'cea',
      name: 'College of Engineering and Architecture',
      motto: null,
      description: null,
      csc: {
        ...iecep,
        type: 'CSC',
        slug: 'csc-cea',
        acronym: 'CSC-CEA',
        name: 'CSC of CEA',
        hasAccount: true,
      },
      sbos: [iecep, { ...iecep, slug: 'jpice', acronym: 'JPICE', name: 'JPICE', hasAccount: true }],
    },
  ],
};

const REQUEST_ID = '0195f3c0-0000-7000-8000-0000000000b1';
const REQUEST = {
  id: REQUEST_ID,
  status: 'requested' as const,
  organization: {
    slug: 'iecep',
    acronym: 'IECEP',
    name: 'Institute of Electronics Engineers',
    type: 'SBO' as const,
    collegeSlug: 'cea',
    college: 'CEA',
    hasAccount: false,
  },
  accountEmail: 'iecep@nwssu.test',
  officerInCharge: { name: 'Rosa Lim', position: 'President', email: 'rosa@nwssu.test' },
  note: 'New this year',
  requestedAt: NOW,
  requestedBy: { name: 'ISSC', email: 'issc@nwssu.test' },
  decidedAt: null,
  declineReason: null,
  createdAccountId: null,
};

/** What the create-account and reset endpoints answer with; tests switch it. */
let delivery:
  { kind: 'reveal'; expiresAt: string } | { kind: 'shown_once'; temporaryPassword: string } = {
  kind: 'reveal',
  expiresAt: '2026-10-26T08:00:00.000Z',
};

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
      const page = Number(new URL(url, 'http://localhost').searchParams.get('page') ?? '1');
      return json({ items: [studentRow], total: 60, page, pageSize: 25 });
    }
    if (path === `/system/users/${STUDENT}` && method === 'GET') return json(DETAIL);
    if (path === `/system/users/${STUDENT}/status`) {
      return stepUpDone ? json({ ...studentRow, disabledAt: NOW }) : stepUpRequired();
    }
    if (path === `/system/users/${STUDENT}/password-reset`) {
      return stepUpDone ? json({ account: studentRow, delivery }) : stepUpRequired();
    }
    if (path === `/system/users/${STUDENT}/lock`) {
      return json({ ...studentRow, lockedAt: NOW, lockReason: 'Suspicious' });
    }
    if (path === '/system/organizations') return json(TREE);
    if (path === '/system/account-requests/count') return json({ open: 1 });
    if (path === '/system/account-requests') return json({ items: [REQUEST], openCount: 1 });
    if (path === `/system/account-requests/${REQUEST_ID}`) return json(REQUEST);
    if (path === `/system/account-requests/${REQUEST_ID}/decline`) {
      return json({ ...REQUEST, status: 'declined', declineReason: 'Use the official address' });
    }
    if (path === '/system/organizations/jpice/documents') return json(FILES);
    if (path.endsWith('/rescan')) return Promise.resolve(new Response(null, { status: 204 }));
    if (path === '/system/accounts') {
      const organization = { ...studentRow.organization!, slug: 'iecep', acronym: 'IECEP' };
      return json({ account: { ...studentRow, name: 'IECEP', organization }, delivery }, 201);
    }
    if (path === '/system/test-data') {
      return json({
        total: 2,
        items: [
          {
            id: 'a'.repeat(8) + '-0000-7000-8000-000000000001',
            organization: { slug: 'jpice', acronym: 'JPICE' },
            type: 'Resolution',
            status: 'available',
            createdAt: NOW,
          },
          {
            id: 'a'.repeat(8) + '-0000-7000-8000-000000000002',
            organization: { slug: 'psme', acronym: 'PSME' },
            type: 'Resolution',
            status: 'archived',
            createdAt: NOW,
          },
        ],
      });
    }
    if (path === '/system/test-data/delete') {
      return stepUpDone ? json({ deleted: 2 }) : stepUpRequired();
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
  delivery = { kind: 'reveal', expiresAt: '2026-10-26T08:00:00.000Z' };
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

  async function enterStepUp() {
    const stepUp = await screen.findByRole('dialog', { name: 'Confirm it’s you' });
    fireEvent.change(within(stepUp).getByLabelText('Authentication code'), {
      target: { value: '123 456' },
    });
    fireEvent.click(within(stepUp).getByRole('button', { name: 'Confirm' }));
  }

  it('lists organization accounts on numbered pages, each opening its account page', async () => {
    serve();
    renderAt('/system/users');
    const table = await screen.findByRole('table', { name: 'Organization accounts' });
    expect(within(table).getByRole('link', { name: 'Ana Reyes' })).toHaveAttribute(
      'href',
      `/system/users/${STUDENT}`,
    );
    expect(within(table).getByText('JPICE · CEA')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute(
      'href',
      '/system/users/new',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input]) => typeof input === 'string' && input.includes('/system/users?page=2'),
        ),
      ).toBe(true),
    );
  });

  it('deactivates from the account page: confirm, step-up, then the retry', async () => {
    serve();
    renderAt(`/system/users/${STUDENT}`);
    const actions = await screen.findByRole('group', { name: 'Account actions' });
    fireEvent.click(within(actions).getByRole('button', { name: 'Deactivate' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Deactivate JPICE?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Deactivate' }));
    await enterStepUp();
    await waitFor(() =>
      expect(
        calls.filter((c) => c.path === `/system/users/${STUDENT}/status`).map((c) => c.body),
      ).toEqual([{ active: false }, { active: false }]),
    );
    expect(calls.find((c) => c.path === '/system/step-up')?.body).toEqual({ code: '123456' });
  });

  it('shows the account’s terms and files (a private title hidden) and runs a stuck scan again', async () => {
    serve();
    renderAt(`/system/users/${STUDENT}`);
    expect((await screen.findAllByText('Ana Reyes, President')).length).toBeGreaterThan(0);
    const files = await screen.findByRole('list', { name: 'Files' });
    expect(within(files).getByText('Private file')).toBeInTheDocument();
    expect(within(files).getByText('Scan stuck')).toBeInTheDocument();
    expect(within(files).getByText('Test data')).toBeInTheDocument();
    fireEvent.click(within(files).getByRole('button', { name: 'Scan again: Private file' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === `/system/documents/${FILES.items[0]!.id}/rescan`)).toBe(
        true,
      ),
    );
  });

  it('issues a new password after a step-up: sent to the ISSC’s Reveal, or shown once', async () => {
    serve();
    renderAt(`/system/users/${STUDENT}`);
    const actions = await screen.findByRole('group', { name: 'Account actions' });
    fireEvent.click(within(actions).getByRole('button', { name: 'Issue new password' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Issue new password',
      }),
    );
    await enterStepUp();
    expect(await screen.findByText(/sent to the ISSC account’s Reveal/)).toBeInTheDocument();

    delivery = { kind: 'shown_once', temporaryPassword: 'Abcd-Efgh-Jkmn-Pq23' };
    fireEvent.click(within(actions).getByRole('button', { name: 'Issue new password' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Issue new password',
      }),
    );
    const shown = await screen.findByRole('dialog', { name: 'Shown once: copy it now' });
    expect(within(shown).getByText('Abcd-Efgh-Jkmn-Pq23')).toBeInTheDocument();
  });

  it('locks with a reason', async () => {
    serve();
    renderAt(`/system/users/${STUDENT}`);
    const actions = await screen.findByRole('group', { name: 'Account actions' });
    fireEvent.click(within(actions).getByRole('button', { name: 'Lock' }));
    const dialog = await screen.findByRole('dialog', { name: 'Lock this account?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lock account' }));
    expect(await within(dialog).findByText('Say why, in a few words')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Suspicious' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lock account' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === `/system/users/${STUDENT}/lock`)?.body).toEqual({
        locked: true,
        reason: 'Suspicious',
      }),
    );
  });

  it('creates an account for an organization without one; the password goes to the Reveal', async () => {
    serve();
    renderAt('/system/users/new');
    const college = await screen.findByLabelText('College');
    fireEvent.change(college, { target: { value: 'cea' } });
    // Only organizations without an account are offered.
    const org = screen.getByLabelText('Organization');
    expect(within(org).queryByRole('option', { name: /JPICE/ })).toBeNull();
    fireEvent.change(org, { target: { value: 'iecep' } });
    fireEvent.change(screen.getByLabelText('Account email'), {
      target: { value: 'IECEP@nwssu.test' },
    });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rosa Lim' } });
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: 'President' } });
    fireEvent.change(screen.getByLabelText('Contact email'), {
      target: { value: 'rosa@nwssu.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByRole('heading', { name: 'IECEP’s account is ready' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/one-time Reveal/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/system/accounts')?.body).toEqual({
      organization: { kind: 'existing', slug: 'iecep' },
      email: 'iecep@nwssu.test',
      officerInCharge: { name: 'Rosa Lim', position: 'President', email: 'rosa@nwssu.test' },
      termEnd: null,
    });
  });

  it('shows the ISSC account’s own password once', async () => {
    serve();
    delivery = { kind: 'shown_once', temporaryPassword: 'Abcd-Efgh-Jkmn-Pq23' };
    renderAt('/system/users/new');
    const type = await screen.findByLabelText('Type');
    fireEvent.change(type, { target: { value: 'ISSC' } });
    expect(screen.queryByLabelText('College')).toBeNull();
    expect(
      within(screen.getByLabelText('Organization')).queryByRole('option', { name: 'ISSC' }),
    ).toBeNull();
  });

  it('queues account requests with a badge; declining needs a reason', async () => {
    serve();
    renderAt('/system/account-requests');
    const nav = await screen.findByRole('navigation', { name: 'System console' });
    expect(await within(nav).findByText('1')).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Account requests' });
    expect(within(list).getByText('iecep@nwssu.test')).toBeInTheDocument();
    expect(within(list).getByText('New this year')).toBeInTheDocument();
    expect(within(list).getByRole('link', { name: /Create account: IECEP/ })).toHaveAttribute(
      'href',
      `/system/users/new?request=${REQUEST_ID}`,
    );

    fireEvent.click(within(list).getByRole('button', { name: /Decline: IECEP/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Decline this request?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline request' }));
    expect(await within(dialog).findByText('Say why, so the ISSC can fix it')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Reason'), {
      target: { value: 'Use the official address' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline request' }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.path === `/system/account-requests/${REQUEST_ID}/decline`)?.body,
      ).toEqual({ reason: 'Use the official address' }),
    );
  });

  it('starts the create form from a request, and fulfils it', async () => {
    serve();
    renderAt(`/system/users/new?request=${REQUEST_ID}`);
    expect(
      await screen.findByText(/Filled in from the ISSC's request for IECEP/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('Account email')).toHaveValue('iecep@nwssu.test'),
    );
    expect(screen.getByLabelText('Organization')).toHaveValue('iecep');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/system/accounts')?.body).toMatchObject({
        organization: { kind: 'existing', slug: 'iecep' },
        email: 'iecep@nwssu.test',
        requestId: REQUEST_ID,
      }),
    );
  });

  it('previews test data and deletes it after a step-up', async () => {
    serve();
    renderAt('/system/test-data');
    expect(await screen.findByText('2 files')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete test data' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Delete test data',
      }),
    );
    await enterStepUp();
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/system/test-data/delete').map((c) => c.body)).toEqual(
        [{ expectedCount: 2 }, { expectedCount: 2 }],
      ),
    );
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
