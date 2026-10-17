import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AuthResponse,
  DashboardResponse,
  MembershipRole,
  SemestralReport,
} from '@orghive/shared';
import { routes } from '@/app/router';
import { authStore } from '@/lib/auth-store';
import { semesterOptions } from './presenters/use-semestral-reports';

const JPICE_ID = '0195f3c0-0000-7000-8000-0000000000a1';
const REPORT_ID = '0195f3c0-0000-7000-8000-0000000000b1';
const DOC_ID = '0195f3c0-0000-7000-8000-0000000000d1';
const VERSION_ID = '0195f3c0-0000-7000-8000-0000000000e1';

let role: MembershipRole = 'officer';
let reports: SemestralReport[] = [];
const fetchMock = vi.fn<typeof fetch>();
const calls: { url: string; method: string; body?: unknown }[] = [];
const assign = vi.fn();

function session(): AuthResponse {
  return {
    accessToken: 'test-token',
    expiresIn: 900,
    user: {
      id: '0195f3c0-0000-7000-8000-000000000001',
      name: 'Juan Dela Cruz',
      email: 'juan@nwssu.test',
      mustChangePassword: false,
      roles: [{ orgId: JPICE_ID, role, isHead: false }],
      memberships: [
        {
          orgId: JPICE_ID,
          orgSlug: 'jpice',
          orgAcronym: 'JPICE',
          role,
          isHead: false,
          title: null,
        },
      ],
    },
  };
}

function dashboard(): DashboardResponse {
  return {
    memberships: [
      { organizationId: JPICE_ID, role, isHead: false, title: null, termEnd: '2027-07-31' },
    ],
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
        counts: { public: 1, members: 0, private: 0, scanning: 0, quarantined: 0, archived: 0 },
        recentDocuments: [],
        quarantined: [],
        activity: [],
      },
    ],
    isAdmin: false,
  };
}

function report(overrides: Partial<SemestralReport> = {}): SemestralReport {
  return {
    id: REPORT_ID,
    academicYear: '2026-2027',
    semester: 'first',
    status: 'queued',
    progress: 0,
    error: null,
    requestedBy: { name: 'Juan Dela Cruz' },
    createdAt: '2026-10-17T13:30:00.000Z',
    finishedAt: null,
    document: null,
    ...overrides,
  };
}

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

beforeEach(() => {
  role = 'officer';
  reports = [];
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('location', { ...window.location, assign });
  fetchMock.mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url, method, body });
    if (url.endsWith('/me/dashboard')) return json(dashboard());
    if (url.endsWith('/me/notifications')) return json({ items: [], unreadCount: 0 });
    if (url.endsWith('/organizations/jpice/projects')) return json({ items: [] });
    if (url.endsWith('/organizations/jpice/compliance')) {
      return json({
        frozen: false,
        freezes: [],
        blockedProjects: [],
        decider: { type: 'CSC', slug: 'csc-cea', acronym: 'CSC-CEA', name: 'CSC of CEA' },
      });
    }
    if (url.endsWith('/organizations/jpice/semestral-reports')) {
      if (method === 'POST') {
        reports = [report()];
        return json(reports[0], 202);
      }
      const current = reports;
      // The worker moves on between polls: queued -> generating -> ready.
      reports = reports.map((r) =>
        r.status === 'queued'
          ? { ...r, status: 'generating', progress: 40 }
          : r.status === 'generating'
            ? {
                ...r,
                status: 'ready',
                progress: 100,
                document: { id: DOC_ID, title: 'Semestral End Report', versionId: VERSION_ID },
              }
            : r,
      );
      return json({ items: current });
    }
    if (url.endsWith(`/documents/${DOC_ID}/versions/${VERSION_ID}/download-url`)) {
      return json({
        url: 'https://storage.test/report.pdf?signed',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      });
    }
    return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  });
});

afterEach(() => {
  fetchMock.mockReset();
  assign.mockReset();
  calls.length = 0;
  vi.unstubAllGlobals();
  authStore.reset();
  window.localStorage.clear();
});

function renderDashboard() {
  authStore.setSession(session());
  const router = createMemoryRouter(routes, { initialEntries: ['/dashboard'] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('semesterOptions', () => {
  it('lists the semesters that have started, newest first, over three academic years', () => {
    const options = semesterOptions('2026-10-17');
    expect(options[0]).toEqual({ value: '2026-2027:first', label: '1st semester 2026-2027' });
    expect(options.map((o) => o.value).slice(0, 4)).toEqual([
      '2026-2027:first',
      '2025-2026:midyear',
      '2025-2026:second',
      '2025-2026:first',
    ]);
    // Not yet started: 2nd semester and midyear of 2026-2027.
    expect(options.some((o) => o.value === '2026-2027:second')).toBe(false);
    expect(options).toHaveLength(7);
  });
});

describe('the Semestral End Report panel', () => {
  it('generates a report for the chosen semester, shows progress, then downloads it', async () => {
    renderDashboard();
    const panel = (await screen.findByRole('heading', { name: 'Semestral End Report' })).closest(
      'section',
    )!;
    expect(await within(panel).findByText(/No reports yet/)).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'Generate Semestral End Report' }));
    const dialog = await screen.findByRole('dialog', { name: 'Generate Semestral End Report' });
    fireEvent.change(within(dialog).getByLabelText('Semester'), {
      target: { value: '2025-2026:second' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Generate' }));

    await waitFor(() =>
      expect(
        calls.find((c) => c.method === 'POST' && c.url.endsWith('/semestral-reports'))?.body,
      ).toEqual({
        academicYear: '2025-2026',
        semester: 'second',
      }),
    );
    // Polls every 2 s while it runs: queued, then generating 40 %, then ready.
    expect(
      await within(panel).findByRole('progressbar', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    const download = await within(panel).findByRole(
      'button',
      { name: /Download PDF/ },
      { timeout: 8000 },
    );
    fireEvent.click(download);
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://storage.test/report.pdf?signed'),
    );
    expect(within(panel).getByRole('link', { name: /Open/ })).toHaveAttribute(
      'href',
      `/documents/${DOC_ID}`,
    );
  }, 20_000);

  it('shows why a report failed', async () => {
    reports = [
      report({
        status: 'failed',
        error: 'Something went wrong while making the report. Try again.',
      }),
    ];
    renderDashboard();
    expect(
      await screen.findByText('Something went wrong while making the report. Try again.'),
    ).toBeInTheDocument();
  });

  it('is not shown to advisers', async () => {
    role = 'adviser';
    renderDashboard();
    await screen.findByText(/Junior Philippine Institute of Civil Engineers/);
    expect(screen.queryByRole('heading', { name: 'Semestral End Report' })).toBeNull();
    expect(calls.some((c) => c.url.endsWith('/semestral-reports'))).toBe(false);
  });
});
