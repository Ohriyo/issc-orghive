import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthResponse, ComplianceOverview, ComplianceRow } from '@orghive/shared';
import { routes } from '@/app/router';
import { authStore } from '@/lib/auth-store';
import {
  csvFilename,
  overviewCsv,
  sortRows,
  toRowView,
  totalsOf,
} from './presenters/compliance-format';
import { parseSemester } from './presenters/use-compliance-overview';

const NOW = new Date('2026-10-18T04:00:00.000Z');
const PROJECT_A = '0195f3c0-0000-7000-8000-0000000000c1';
const PROJECT_B = '0195f3c0-0000-7000-8000-0000000000c2';

function row(acronym: string, overrides: Partial<ComplianceRow> = {}): ComplianceRow {
  return {
    organization: {
      type: 'SBO',
      slug: acronym.toLowerCase(),
      acronym,
      name: `${acronym} full name`,
      college: 'CEA',
    },
    activeProjects: 1,
    blockedProjects: [],
    nextDeadline: null,
    overdueTasks: [],
    frozenSince: null,
    openAppeals: 0,
    ...overrides,
  };
}

const overdue = (daysOverdue: number, projectName = 'Bridge contest') => ({
  projectId: PROJECT_A,
  projectName,
  task: 'ACR' as const,
  dueAt: '2026-10-01T15:59:59.999Z',
  daysOverdue,
});

const JPICE = row('JPICE', {
  activeProjects: 2,
  overdueTasks: [overdue(12), overdue(3)],
  blockedProjects: [{ id: PROJECT_B, name: 'Seminar' }],
  frozenSince: '2026-10-03T02:00:00.000Z',
  openAppeals: 1,
});
const PSME = row('PSME', {
  overdueTasks: [overdue(20)],
  nextDeadline: {
    projectId: PROJECT_A,
    projectName: '=HYPERLINK("x")',
    task: 'PROPOSAL',
    dueAt: '2026-10-20T15:59:59.999Z',
  },
});
const UAPSA = row('UAPSA');

const OVERVIEW: ComplianceOverview = {
  academicYear: '2026-2027',
  semester: 'first',
  scope: { type: 'CSC', acronym: 'CSC-CEA' },
  organizations: [UAPSA, JPICE, PSME],
};

describe('compliance overview rules', () => {
  it('sorts by the oldest overdue task first, or by name', () => {
    expect(sortRows(OVERVIEW.organizations, 'overdue').map((r) => r.organization.acronym)).toEqual([
      'PSME',
      'JPICE',
      'UAPSA',
    ]);
    expect(sortRows(OVERVIEW.organizations, 'name').map((r) => r.organization.acronym)).toEqual([
      'JPICE',
      'PSME',
      'UAPSA',
    ]);
  });

  it('shapes a row in words, with Manila dates', () => {
    const view = toRowView(JPICE, NOW);
    expect(view.kind).toBe('SBO · CEA');
    expect(view.overdue.text).toBe('2 tasks, oldest 12 days');
    expect(view.overdue.oldest?.href).toBe(`/projects/${PROJECT_A}`);
    expect(view.frozen).toBe('Frozen since Oct 3, 2026');
    expect(view.blocked).toEqual([
      { id: PROJECT_B, name: 'Seminar', href: `/projects/${PROJECT_B}` },
    ]);
    expect(toRowView(PSME, NOW).nextDeadline?.label.text).toBe('Due in 2 days');
    expect(toRowView(UAPSA, NOW).overdue.text).toBeNull();
  });

  it('adds up the totals', () => {
    expect(totalsOf(OVERVIEW.organizations)).toEqual({
      organizations: 3,
      withOverdue: 2,
      blockedProjects: 1,
      frozen: 1,
      openAppeals: 1,
    });
  });

  it('exports CSV in screen order, with formulas neutralised', () => {
    const csv = overviewCsv(sortRows(OVERVIEW.organizations, 'overdue'));
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toMatch(/^Organization,Name,Type,College,Active projects,Next deadline,/);
    expect(lines[1]).toBe(
      `PSME,PSME full name,SBO,CEA,1,2026-10-20,Project Proposal,"'=HYPERLINK(""x"")",1,20,0,,,0`,
    );
    expect(lines[2]).toContain('JPICE,JPICE full name,SBO,CEA,2,,,,2,12,1,Seminar,2026-10-03,1');
    expect(lines).toHaveLength(4);
  });

  it('names the file after the council and semester', () => {
    expect(csvFilename(OVERVIEW)).toBe('compliance-csc-cea-2026-2027-1st-semester.csv');
  });

  it('reads the semester from the URL, falling back to the current one', () => {
    expect(parseSemester('2025-2026:second', '2026-2027:first')).toEqual({
      academicYear: '2025-2026',
      semester: 'second',
      value: '2025-2026:second',
    });
    expect(parseSemester('2025-2027:first', '2026-2027:first').value).toBe('2026-2027:first');
    expect(parseSemester('nonsense', '2026-2027:first').semester).toBe('first');
    expect(parseSemester(null, '2026-2027:first').academicYear).toBe('2026-2027');
  });
});

function session(): AuthResponse {
  const orgId = '0195f3c0-0000-7000-8000-0000000000a2';
  return {
    accessToken: 'token',
    expiresIn: 900,
    user: {
      id: '0195f3c0-0000-7000-8000-000000000002',
      name: 'Miguel Santos',
      email: 'governor@orghive.test',
      mustChangePassword: false,
      organization: {
        id: orgId,
        type: 'CSC',
        slug: 'csc-cea',
        acronym: 'CSC-CEA',
        name: 'CSC-CEA',
        parentId: null,
      },
      officerInCharge: null,
    },
  };
}

const fetchMock = vi.fn<typeof fetch>();
const calls: { path: string; search: string }[] = [];

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

function serve({ forbidden = false } = {}) {
  fetchMock.mockImplementation((input) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, 'http://localhost');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    calls.push({ path, search: url.search });
    if (path === '/auth/refresh') return json(session());
    if (path === '/compliance/overview') {
      return forbidden
        ? json(
            {
              error: {
                code: 'FORBIDDEN',
                message: 'The compliance overview is for the CSCs and the ISSC',
              },
            },
            403,
          )
        : json(OVERVIEW);
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
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  authStore.reset();
});

describe('/dashboard/compliance', () => {
  it("shows the council's organizations, most overdue first", async () => {
    serve();
    renderAt('/dashboard/compliance?semester=2026-2027:first');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Compliance overview' }),
    ).toBeInTheDocument();
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4); // header + 3
    expect(within(rows[1]!).getByRole('link', { name: 'PSME' })).toHaveAttribute(
      'href',
      '/orgs/psme',
    );
    expect(within(rows[2]!).getByText('since Oct 3, 2026')).toBeInTheDocument();
    expect(screen.getByText(/CSC-CEA: the SBOs of your college/)).toBeInTheDocument();
    expect(calls).toContainEqual({
      path: '/compliance/overview',
      search: '?academicYear=2026-2027&semester=first',
    });
  });

  it('asks again for another semester, and sorts by name', async () => {
    serve();
    const router = renderAt('/dashboard/compliance?semester=2026-2027:first');
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Semester'), { target: { value: '2025-2026:second' } });
    await waitFor(() =>
      expect(calls).toContainEqual({
        path: '/compliance/overview',
        search: '?academicYear=2025-2026&semester=second',
      }),
    );
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'name' } });
    await waitFor(() => expect(router.state.location.search).toContain('sort=name'));
    const rows = within(await screen.findByRole('table')).getAllByRole('row');
    expect(within(rows[1]!).getByRole('link', { name: 'JPICE' })).toBeInTheDocument();
  });

  it('downloads the CSV', async () => {
    serve();
    const createObjectURL = vi.fn(() => 'blob:overview');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderAt('/dashboard/compliance?semester=2026-2027:first');
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe(
      'compliance-csc-cea-2026-2027-1st-semester.csv',
    );
    click.mockRestore();
  });

  it('explains who it is for when the server refuses', async () => {
    serve({ forbidden: true });
    renderAt('/dashboard/compliance');
    expect(await screen.findByText('For the CSCs and the ISSC')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
