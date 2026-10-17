import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addDays,
  deadlineAfter,
  manilaDate,
  type Appeal,
  type AuthResponse,
  type DashboardResponse,
  type MembershipRole,
  type NotificationListResponse,
  type OrganizationCompliance,
  type ProjectDetail,
} from '@orghive/shared';
import { routes } from '@/app/router';
import { authStore } from '@/lib/auth-store';
import { toComplianceSummary } from './presenters/appeal-format';

const JPICE_ID = '0195f3c0-0000-7000-8000-0000000000a1';
const CSC_ID = '0195f3c0-0000-7000-8000-0000000000a2';
const PROJECT_ID = '0195f3c0-0000-7000-8000-0000000000c1';
const FREEZE_ID = '0195f3c0-0000-7000-8000-0000000000f1';
const APPEAL_ID = '0195f3c0-0000-7000-8000-0000000000b1';
const NOTE_ID = '0195f3c0-0000-7000-8000-0000000000e1';
const today = manilaDate(new Date());
const JPICE = { type: 'SBO' as const, slug: 'jpice', acronym: 'JPICE', name: 'JPICE full name' };
const CSC = { type: 'CSC' as const, slug: 'csc-cea', acronym: 'CSC-CEA', name: 'CSC of CEA' };

type Who = 'officer' | 'adviser' | 'governor';

function session(who: Who): AuthResponse {
  const governor = who === 'governor';
  const role: MembershipRole = who === 'adviser' ? 'adviser' : 'officer';
  const orgId = governor ? CSC_ID : JPICE_ID;
  return {
    accessToken: 'test-token',
    expiresIn: 900,
    user: {
      id: '0195f3c0-0000-7000-8000-000000000001',
      name: 'Juan Dela Cruz',
      email: 'juan@nwssu.test',
      mustChangePassword: false,
      roles: [{ orgId, role, isHead: governor }],
      memberships: [
        {
          orgId,
          orgSlug: governor ? 'csc-cea' : 'jpice',
          orgAcronym: governor ? 'CSC-CEA' : 'JPICE',
          role,
          isHead: governor,
          title: governor ? 'Governor' : null,
        },
      ],
    },
  };
}

function dashboard(who: Who): DashboardResponse {
  const governor = who === 'governor';
  const org = governor ? { ...CSC, id: CSC_ID } : { ...JPICE, id: JPICE_ID };
  return {
    memberships: [
      {
        organizationId: org.id,
        role: who === 'adviser' ? 'adviser' : 'officer',
        isHead: governor,
        title: null,
        termEnd: '2027-07-31',
      },
    ],
    organizations: [
      {
        organization: { ...org, logoUrl: null, logoSrcSet: null },
        counts: { public: 1, members: 0, private: 0, scanning: 0, quarantined: 0, archived: 0 },
        recentDocuments: [],
        quarantined: [],
        activity: [],
      },
    ],
    isAdmin: false,
  };
}

function blockedProject(): ProjectDetail {
  const createdAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
  const targetDate = addDays(today, 10);
  const proposalDueAt = deadlineAfter(createdAt).toISOString();
  const postEventDueAt = deadlineAfter(targetDate).toISOString();
  return {
    id: PROJECT_ID,
    name: 'Bridge Design Competition',
    targetDate,
    location: 'CEA Building',
    beneficiaries: 'Civil engineering students',
    description: 'A truss bridge competition.',
    status: 'blocked',
    proposalDueAt,
    postEventDueAt,
    nomRequired: false,
    momRequired: false,
    nextDeadline: null,
    organization: JPICE,
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
    tasks: [
      {
        type: 'PROPOSAL',
        status: 'locked',
        dueAt: proposalDueAt,
        submittedAt: null,
        document: null,
      },
      { type: 'ACR', status: 'locked', dueAt: postEventDueAt, submittedAt: null, document: null },
      {
        type: 'FINANCIAL_REPORT',
        status: 'locked',
        dueAt: postEventDueAt,
        submittedAt: null,
        document: null,
      },
    ],
  };
}

function appeal(overrides: Partial<Appeal> = {}): Appeal {
  return {
    id: APPEAL_ID,
    type: 'PROJECT_BLOCK',
    status: 'rejected',
    reason: 'Our adviser was on leave, so the proposal could not be signed in time.',
    remarks: 'Attach the adviser’s leave notice.',
    newDueAt: null,
    submittedAt: '2026-10-16T02:00:00.000Z',
    decidedAt: '2026-10-17T02:00:00.000Z',
    submittedBy: { name: 'Juan Dela Cruz' },
    decidedBy: { name: 'Maria Santos' },
    organization: JPICE,
    decider: CSC,
    project: { id: PROJECT_ID, name: 'Bridge Design Competition', targetDate: addDays(today, 10) },
    freeze: null,
    attachments: [],
    canDecide: false,
    ...overrides,
  };
}

let compliance: OrganizationCompliance;
let history: Appeal[];
let queue: Appeal[];
let notifications: NotificationListResponse;
let who: Who = 'officer';
const fetchMock = vi.fn<typeof fetch>();
const calls: { url: string; method: string; body?: unknown }[] = [];

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(body === null ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

beforeEach(() => {
  who = 'officer';
  compliance = {
    frozen: false,
    freezes: [],
    blockedProjects: [
      {
        id: PROJECT_ID,
        name: 'Bridge Design Competition',
        proposalDueAt: blockedProject().proposalDueAt,
        pendingAppeal: null,
        lastRejection: {
          remarks: 'Attach the adviser’s leave notice.',
          decidedAt: '2026-10-17T02:00:00.000Z',
        },
      },
    ],
    decider: CSC,
  };
  history = [appeal()];
  queue = [
    appeal({ status: 'pending', remarks: null, decidedAt: null, decidedBy: null, canDecide: true }),
  ];
  notifications = { items: [], unreadCount: 0 };
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url, method, body });
    if (url.endsWith('/me/dashboard')) return json(dashboard(who));
    if (url.endsWith('/me/notifications')) return json(notifications);
    if (url.includes('/me/notifications/')) return json(null, 204);
    if (url.endsWith('/organizations/jpice/compliance')) return json(compliance);
    if (url.endsWith('/organizations/jpice/projects')) return json({ items: [] });
    if (url.endsWith('/organizations/jpice/appeals') && method === 'POST') {
      return json(
        appeal({ status: 'pending', remarks: null, decidedAt: null, decidedBy: null }),
        201,
      );
    }
    if (url.endsWith(`/projects/${PROJECT_ID}/appeals`)) return json({ items: history });
    if (url.endsWith(`/projects/${PROJECT_ID}`)) return json(blockedProject());
    if (url.includes('/appeals/queue')) {
      return json({ items: url.endsWith('status=pending') ? queue : [] });
    }
    if (url.endsWith(`/appeals/${APPEAL_ID}/decision`)) {
      queue = [];
      const decision = body as { decision: string; remarks?: string };
      return json(
        appeal({
          status: decision.decision === 'approve' ? 'approved' : 'rejected',
          remarks: decision.remarks ?? null,
        }),
      );
    }
    return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  });
});

afterEach(() => {
  fetchMock.mockReset();
  calls.length = 0;
  vi.unstubAllGlobals();
  authStore.reset();
  window.localStorage.clear();
});

function renderAt(url: string) {
  authStore.setSession(session(who));
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('toComplianceSummary', () => {
  it('offers officers an appeal for each block and freeze without a pending one', () => {
    const data: OrganizationCompliance = {
      ...compliance,
      frozen: true,
      freezes: [
        {
          id: FREEZE_ID,
          project: { id: PROJECT_ID, name: 'Seminar' },
          reports: ['ACR', 'FINANCIAL_REPORT'],
          frozenAt: '2026-10-17T02:00:00.000Z',
          pendingAppeal: { id: APPEAL_ID, submittedAt: '2026-10-17T03:00:00.000Z' },
          lastRejection: null,
        },
      ],
    };
    const summary = toComplianceSummary(data, 'jpice', true);
    expect(summary.notices.map((n) => n.kind)).toEqual(['frozen', 'blocked']);
    const [freeze, block] = summary.notices;
    expect(freeze!.appealHref).toBeNull();
    expect(freeze!.pending).toBe('Appeal submitted Oct 17, 2026. CSC-CEA will decide it.');
    expect(freeze!.message).toContain('Activity Completion Report and Financial Report');
    expect(block!.appealHref).toBe(`/dashboard/appeals/new?org=jpice&project=${PROJECT_ID}`);
    expect(block!.rejection).toEqual({
      remarks: 'Attach the adviser’s leave notice.',
      date: 'Oct 17, 2026',
    });
    // Advisers see the banner but cannot appeal.
    expect(toComplianceSummary(data, 'jpice', false).notices.every((n) => !n.appealHref)).toBe(
      true,
    );
  });
});

describe('a blocked project page', () => {
  it('shows the banner with the last rejection, "Appeal again", and the appeal history', async () => {
    renderAt(`/projects/${PROJECT_ID}`);
    const banner = await screen.findByRole('region', {
      name: 'Bridge Design Competition is blocked',
    });
    expect(
      within(banner).getByText(/Remarks: Attach the adviser’s leave notice/),
    ).toBeInTheDocument();
    expect(within(banner).getByRole('link', { name: 'Appeal again' })).toHaveAttribute(
      'href',
      `/dashboard/appeals/new?org=jpice&project=${PROJECT_ID}`,
    );
    const appeals = await screen.findByRole('heading', { name: 'Appeals' });
    const section = appeals.closest('section')!;
    expect(within(section).getByText('Rejected')).toBeInTheDocument();
    expect(within(section).getByText(/Rejected Oct 17, 2026 by Maria Santos/)).toBeInTheDocument();
  });

  it('gives an adviser the banner without the appeal button', async () => {
    who = 'adviser';
    renderAt(`/projects/${PROJECT_ID}`);
    const banner = await screen.findByRole('region', {
      name: 'Bridge Design Competition is blocked',
    });
    expect(within(banner).queryByRole('link', { name: /appeal/i })).toBeNull();
  });
});

describe('submitting an appeal', () => {
  it('validates the reason with the shared rule, then posts it and returns to the project', async () => {
    const router = renderAt(`/dashboard/appeals/new?org=jpice&project=${PROJECT_ID}`);
    await screen.findByRole('heading', { name: 'Appeal the block' });
    expect(screen.getByText(/Your last appeal was rejected/)).toBeInTheDocument();

    const reason = screen.getByLabelText('Reason');
    fireEvent.change(reason, { target: { value: 'Too short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit appeal to CSC-CEA' }));
    expect(
      await screen.findByText('Explain the appeal in at least 20 characters'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    fireEvent.change(reason, {
      target: { value: 'Our adviser was on leave, so the proposal could not be signed in time.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit appeal to CSC-CEA' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${PROJECT_ID}`));
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/appeals'))?.body).toEqual({
      type: 'PROJECT_BLOCK',
      projectId: PROJECT_ID,
      reason: 'Our adviser was on leave, so the proposal could not be signed in time.',
      attachmentIds: [],
    });
  });

  it('says so when there is nothing to appeal', async () => {
    compliance = { ...compliance, blockedProjects: [] };
    renderAt(`/dashboard/appeals/new?org=jpice&project=${PROJECT_ID}`);
    expect(
      await screen.findByText('This project is not blocked, so there is nothing to appeal.'),
    ).toBeInTheDocument();
  });

  it('refuses an adviser', async () => {
    who = 'adviser';
    renderAt(`/dashboard/appeals/new?org=jpice&project=${PROJECT_ID}`);
    expect(
      await screen.findByText("Only JPICE's officers submit its appeals."),
    ).toBeInTheDocument();
  });
});

describe('the appeals queue', () => {
  it('rejecting needs remarks; a decision posts and empties the queue', async () => {
    who = 'governor';
    renderAt('/dashboard/appeals');
    const card = await screen.findByRole('article', { name: 'Bridge Design Competition' });
    fireEvent.click(within(card).getByRole('button', { name: 'Reject…' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Reject appeal' }));
    expect(
      await within(card).findByText('Explain the rejection in at least 10 characters'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/decision'))).toBe(false);

    fireEvent.change(within(card).getByLabelText('Remarks'), {
      target: { value: 'Attach the signed leave notice, please.' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Reject appeal' }));
    expect(await screen.findByText('Nothing waiting for your decision')).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/decision'))?.body).toEqual({
      decision: 'reject',
      remarks: 'Attach the signed leave notice, please.',
    });
  });

  it('approving needs a date after today', async () => {
    who = 'governor';
    renderAt('/dashboard/appeals');
    const card = await screen.findByRole('article', { name: 'Bridge Design Competition' });
    fireEvent.click(within(card).getByRole('button', { name: 'Approve…' }));
    const date = within(card).getByLabelText('New due date');
    fireEvent.change(date, { target: { value: today } });
    fireEvent.click(within(card).getByRole('button', { name: 'Approve appeal' }));
    expect(
      await within(card).findByText('The new due date must be after today'),
    ).toBeInTheDocument();
    fireEvent.change(date, { target: { value: addDays(today, 7) } });
    fireEvent.click(within(card).getByRole('button', { name: 'Approve appeal' }));
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/decision'))?.body).toEqual({
        decision: 'approve',
        newDueDate: addDays(today, 7),
      }),
    );
  });

  it('shows an empty state', async () => {
    who = 'governor';
    queue = [];
    renderAt('/dashboard/appeals');
    expect(await screen.findByText('Nothing waiting for your decision')).toBeInTheDocument();
  });
});

describe('the dashboard', () => {
  it('shows a frozen organization’s banner with "Submit appeal"', async () => {
    compliance = {
      ...compliance,
      frozen: true,
      blockedProjects: [],
      freezes: [
        {
          id: FREEZE_ID,
          project: { id: PROJECT_ID, name: 'Seminar' },
          reports: ['ACR'],
          frozenAt: '2026-10-17T02:00:00.000Z',
          pendingAppeal: null,
          lastRejection: null,
        },
      ],
    };
    renderAt('/dashboard');
    const banner = await screen.findByRole('region', { name: 'Your organization is frozen' });
    expect(within(banner).getByRole('link', { name: 'Submit appeal' })).toHaveAttribute(
      'href',
      `/dashboard/appeals/new?org=jpice&freeze=${FREEZE_ID}`,
    );
  });

  it('links a CSC Governor to the appeals queue', async () => {
    who = 'governor';
    renderAt('/dashboard');
    expect(await screen.findByRole('link', { name: 'Open appeals' })).toHaveAttribute(
      'href',
      '/dashboard/appeals',
    );
  });
});

describe('the notification bell', () => {
  it('shows the unread count, and opening one marks it read and goes to its page', async () => {
    notifications = {
      unreadCount: 1,
      items: [
        {
          id: NOTE_ID,
          kind: 'appeal_decided',
          title: 'Appeal rejected: Bridge Design Competition',
          body: 'CSC-CEA rejected your appeal.',
          link: `/projects/${PROJECT_ID}`,
          readAt: null,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    const router = renderAt('/dashboard');
    const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    fireEvent.pointerDown(bell, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Appeal rejected/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${PROJECT_ID}`));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith(`/me/notifications/${NOTE_ID}/read`))).toBe(true),
    );
  });
});
