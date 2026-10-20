import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addDays,
  deadlineAfter,
  manilaDate,
  type AuthResponse,
  type DashboardResponse,
  type ProjectDetail,
} from '@orghive/shared';
import { routes } from '@/app/router';
import { authStore } from '@/lib/auth-store';
import { accountSession, NO_COUNTS, TEST_ORGS, type TestAccount } from '@/test/accounts';
import { deadlineLabel, lockedHint } from './presenters/project-format';

const JPICE_ID = '0195f3c0-0000-7000-8000-0000000000a1';
const PROJECT_ID = '0195f3c0-0000-7000-8000-0000000000c1';
const DOC_ID = '0195f3c0-0000-7000-8000-0000000000d1';
const UPLOAD_KEY = `uploads/${JPICE_ID}/0195f3c0-0000-7000-8000-0000000000e9`;
const today = manilaDate(new Date());

const JPICE_ORG = { ...TEST_ORGS.jpice, id: JPICE_ID };

/** `own`: JPICE's account. `governing`: CSC-CEA's account, which reads but never manages. */
function session(role: TestAccount): AuthResponse {
  return accountSession(role, JPICE_ORG);
}

function dashboard(role: TestAccount): DashboardResponse {
  const own = role === 'own';
  const org = own ? JPICE_ORG : TEST_ORGS.cscCea;
  return {
    term: {
      officerInCharge: { name: 'Juan Dela Cruz', position: 'President', email: 'juan@nwssu.test' },
      termEnd: '2027-07-31',
    },
    organizations: [
      {
        organization: {
          id: org.id,
          type: org.type,
          slug: org.slug,
          acronym: org.acronym,
          name: own ? 'Junior Philippine Institute of Civil Engineers' : org.name,
          logoUrl: null,
          logoSrcSet: null,
        },
        counts: { ...NO_COUNTS, public: 1 },
        recentDocuments: [],
        quarantined: [],
        activity: [],
        semester: null,
      },
    ],
    isIssc: false,
    canSeeCompliance: !own,
    decidesAppeals: !own,
  };
}

function project(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  const createdAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const targetDate = addDays(today, 20);
  const proposalDueAt = deadlineAfter(createdAt).toISOString();
  const postEventDueAt = deadlineAfter(targetDate).toISOString();
  return {
    id: PROJECT_ID,
    name: 'Inter-Year Bridge Design Competition',
    targetDate,
    location: 'CEA Building',
    beneficiaries: 'Civil engineering students',
    description: 'A truss bridge design and load-testing competition.',
    status: 'active',
    proposalDueAt,
    postEventDueAt,
    nomRequired: true,
    momRequired: false,
    nextDeadline: { type: 'PROPOSAL', dueAt: proposalDueAt },
    organization: { type: 'SBO', slug: 'jpice', acronym: 'JPICE', name: 'JPICE full name' },
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
    tasks: [
      { type: 'PROPOSAL', status: 'open', dueAt: proposalDueAt, submittedAt: null, document: null },
      { type: 'NOM', status: 'locked', dueAt: null, submittedAt: null, document: null },
      { type: 'ACR', status: 'locked', dueAt: postEventDueAt, submittedAt: null, document: null },
      {
        type: 'FINANCIAL_REPORT',
        status: 'locked',
        dueAt: postEventDueAt,
        submittedAt: null,
        document: null,
      },
    ],
    financialFigures: null,
    ...overrides,
  };
}

const fetchMock = vi.fn<typeof fetch>();
const calls: { url: string; method: string; body?: unknown }[] = [];
const puts: string[] = [];
let stored: ProjectDetail[] = [];
let role: TestAccount = 'own';

/** Storage PUTs go through XMLHttpRequest (for progress): a fake that succeeds at once. */
class FakeXhr {
  status = 0;
  upload: {
    onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void;
  } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  private url = '';
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader() {}
  abort() {}
  send() {
    puts.push(this.url);
    setTimeout(() => {
      this.status = 200;
      this.onload?.();
    }, 0);
  }
}

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

beforeEach(() => {
  role = 'own';
  stored = [project()];
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  fetchMock.mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url, method, body });
    if (url.endsWith('/me/dashboard')) return json(dashboard(role));
    if (url.endsWith('/organizations/jpice/projects') && method === 'GET') {
      return json({ items: stored.map(({ tasks: _, ...summary }) => summary) });
    }
    if (url.endsWith('/organizations/jpice/projects') && method === 'POST') {
      const created = project({ ...(body as object), id: PROJECT_ID });
      stored = [created];
      return json(created, 201);
    }
    if (url.endsWith(`/projects/${PROJECT_ID}`)) return json(stored[0]);
    if (/\/tasks\/\w+\/upload-url$/.test(url)) {
      return json(
        {
          uploadKey: UPLOAD_KEY,
          url: 'https://storage.test/put',
          method: 'PUT',
          headers: { 'Content-Type': 'application/pdf' },
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        },
        201,
      );
    }
    if (url.endsWith('/tasks/PROPOSAL/documents')) {
      const visibility = (body as { visibility: 'governing' }).visibility;
      stored = [
        project({
          tasks: project().tasks.map((t) =>
            t.type === 'PROPOSAL'
              ? {
                  ...t,
                  document: {
                    id: DOC_ID,
                    title: 'Project Proposal',
                    status: 'scanning',
                    visibility,
                  },
                }
              : t,
          ),
        }),
      ];
      return json(stored[0], 201);
    }
    if (url.endsWith('/tasks/FINANCIAL_REPORT/documents')) {
      const { figures } = body as { figures: { incomeCentavos: number; expensesCentavos: number } };
      stored = [
        project({
          ...stored[0],
          financialFigures: {
            ...figures,
            netCentavos: figures.incomeCentavos - figures.expensesCentavos,
            underReview: null,
            correctableUntil: new Date(Date.now() + 86_400_000).toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
      ];
      return json(stored[0], 201);
    }
    return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  });
});

afterEach(() => {
  fetchMock.mockReset();
  calls.length = 0;
  puts.length = 0;
  vi.unstubAllGlobals();
  authStore.reset();
  window.localStorage.clear();
});

function renderAt(url: string) {
  authStore.setSession(session(role));
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('project presenter helpers', () => {
  const now = new Date('2026-10-10T02:00:00Z'); // Oct 10, 10:00 Manila

  it('counts deadlines in Manila calendar days', () => {
    expect(deadlineLabel('2026-10-15T15:59:59.999Z', now)).toMatchObject({
      text: 'Due in 5 days',
      tone: 'neutral',
    });
    expect(deadlineLabel('2026-10-12T15:59:59.999Z', now)).toMatchObject({
      text: 'Due in 2 days',
      tone: 'soon',
    });
    expect(deadlineLabel('2026-10-11T15:59:59.999Z', now).text).toBe('Due tomorrow');
    expect(deadlineLabel('2026-10-10T15:59:59.999Z', now).text).toBe('Due today');
    expect(deadlineLabel('2026-10-08T15:59:59.999Z', now)).toMatchObject({
      text: 'Overdue by 2 days',
      tone: 'overdue',
    });
  });

  it('explains locked tasks', () => {
    expect(lockedHint('NOM', '2026-10-20')).toBe('Unlocks once the Project Proposal is submitted.');
    expect(lockedHint('ACR', '2026-10-20')).toMatch(/^Opens on the event day, Oct 20, 2026/);
  });
});

describe('/dashboard projects section', () => {
  it(
    'shows projects in progress with their next deadline, and New project for officers',
    // First test in the file: also loads the lazy routes and the AppShell.
    { timeout: 15_000 },
    async () => {
      renderAt('/dashboard');
      const section = (
        await screen.findByRole('heading', { name: 'Projects', level: 2 }, { timeout: 5000 })
      ).closest('section')!;
      expect(
        await within(section).findByRole('link', { name: 'Inter-Year Bridge Design Competition' }),
      ).toHaveAttribute('href', `/projects/${PROJECT_ID}`);
      expect(within(section).getByText(/Project Proposal: Due in 13 days/)).toBeInTheDocument();
      expect(within(section).getByRole('link', { name: 'New project' })).toHaveAttribute(
        'href',
        '/dashboard/projects/new?org=jpice',
      );
      expect(within(section).getByRole('link', { name: 'All projects' })).toHaveAttribute(
        'href',
        '/dashboard/projects?org=jpice',
      );
    },
  );
});

describe('/dashboard/projects', () => {
  it('lists projects in progress and completed, with status chips', async () => {
    stored = [
      project(),
      project({
        id: '0195f3c0-0000-7000-8000-0000000000c2',
        name: 'Engineering Week',
        status: 'completed',
        nextDeadline: null,
      }),
    ];
    renderAt('/dashboard/projects?org=jpice');
    const inProgress = (
      await screen.findByRole('heading', { name: /In progress/ }, { timeout: 5000 })
    ).closest('section')!;
    expect(within(inProgress).getByText('In progress', { selector: 'span' })).toBeInTheDocument();
    const completed = screen.getByRole('heading', { name: /Completed/ }).closest('section')!;
    expect(within(completed).getByText('Engineering Week')).toBeInTheDocument();
    expect(within(completed).getByText('Every task is submitted.')).toBeInTheDocument();
  });

  it('shows an empty state with a way to start', async () => {
    stored = [];
    renderAt('/dashboard/projects?org=jpice');
    expect(await screen.findByText(/No projects yet/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'New project' }).length).toBeGreaterThan(0);
  });
});

describe('/dashboard/projects/new', () => {
  it('requires the five fields and refuses a past target date', async () => {
    renderAt('/dashboard/projects/new?org=jpice');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Create project' }, { timeout: 5000 }),
    );
    expect(await screen.findByText('Use at least 3 characters')).toBeInTheDocument();
    expect(screen.getByText('Choose the event date')).toBeInTheDocument();
    expect(screen.getByText('Enter the location')).toBeInTheDocument();
    expect(screen.getByText('Enter the target beneficiaries')).toBeInTheDocument();
    expect(screen.getByText('Describe the project briefly')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Target date/), {
      target: { value: addDays(today, -1) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('The target date cannot be in the past')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('creates the project and opens it', async () => {
    const router = renderAt('/dashboard/projects/new?org=jpice');
    const fill = (label: RegExp, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    await screen.findByRole('button', { name: 'Create project' }, { timeout: 5000 });
    fill(/Project name/, 'Inter-Year Bridge Design Competition');
    fill(/Target date/, addDays(today, 20));
    fill(/^Location/, 'CEA Building');
    fill(/Target beneficiaries/, 'Civil engineering students');
    fill(/Brief description/, 'A truss bridge competition.');
    fireEvent.click(screen.getByRole('checkbox', { name: /Notice of Meeting/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${PROJECT_ID}`));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Inter-Year Bridge Design Competition',
      targetDate: addDays(today, 20),
      location: 'CEA Building',
      beneficiaries: 'Civil engineering students',
      description: 'A truss bridge competition.',
      nomRequired: true,
      momRequired: false,
    });
  });

  it('opens the form for the account’s own organization, whatever ?org= names', async () => {
    role = 'governing';
    renderAt('/dashboard/projects/new?org=jpice');
    expect(
      await screen.findByRole('link', { name: 'CSC-CEA projects' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/own account creates its projects/)).not.toBeInTheDocument();
  });
});

describe('/projects/:id', () => {
  it('shows the stepper: pre-event, event, post-event, with each task’s state', async () => {
    renderAt(`/projects/${PROJECT_ID}`);
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Inter-Year Bridge Design Competition' },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    for (const phase of ['Pre-event', 'Event', 'Post-event']) {
      expect(
        screen.getByRole('heading', { level: 3, name: new RegExp(`^${phase}`) }),
      ).toBeInTheDocument();
    }
    const proposal = screen.getByRole('region', { name: 'Project Proposal' });
    expect(within(proposal).getByText('Open')).toBeInTheDocument();
    expect(within(proposal).getByText(/Due in 13 days/)).toBeInTheDocument();
    const nom = screen.getByRole('region', { name: 'Notice of Meeting' });
    expect(within(nom).getByText('Locked')).toBeInTheDocument();
    expect(
      within(nom).getByText('Unlocks once the Project Proposal is submitted.'),
    ).toBeInTheDocument();
    expect(within(nom).queryByRole('button', { name: /Upload/ })).not.toBeInTheDocument();
    const acr = screen.getByRole('region', { name: 'Activity Completion Report' });
    expect(within(acr).getByText(/Opens on the event day/)).toBeInTheDocument();
  });

  it('uploads the proposal with the chosen visibility, then shows it being checked', async () => {
    renderAt(`/projects/${PROJECT_ID}`);
    const proposal = await screen.findByRole(
      'region',
      { name: 'Project Proposal' },
      { timeout: 5000 },
    );
    const select = within(proposal).getByRole('combobox', {
      name: 'Who can see it: Project Proposal',
    });
    expect(select).toHaveValue('private'); // proposals stay with the organization by default
    fireEvent.change(select, { target: { value: 'governing' } });

    const input = proposal.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['%PDF-1.7'], 'proposal.pdf', { type: 'application/pdf' });
    // Filing a task names who acts for the account; without a name nothing is sent.
    fireEvent.change(input, { target: { files: [file] } });
    expect(
      await screen.findByText('Enter your name: who is acting for the account'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/upload-url'))).toBe(false);

    fireEvent.change(screen.getByRole('textbox', { name: 'Acting as' }), {
      target: { value: 'Juan Dela Cruz' },
    });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/tasks/PROPOSAL/documents'))?.body).toEqual({
        uploadKey: UPLOAD_KEY,
        visibility: 'governing',
        actingAs: 'Juan Dela Cruz',
      }),
    );
    expect(puts).toEqual(['https://storage.test/put']);
    expect(calls.find((c) => c.url.endsWith('/tasks/PROPOSAL/upload-url'))?.body).toEqual({
      filename: 'proposal.pdf',
      contentType: 'application/pdf',
      sizeBytes: 8,
    });
    expect(await within(proposal).findByText(/Checking for viruses/)).toBeInTheDocument();
  });

  it('refuses a Word file for a task before sending anything', async () => {
    renderAt(`/projects/${PROJECT_ID}`);
    const proposal = await screen.findByRole(
      'region',
      { name: 'Project Proposal' },
      { timeout: 5000 },
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Acting as' }), {
      target: { value: 'Juan Dela Cruz' },
    });
    const input = proposal.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'proposal.docx')] },
    });
    expect(await within(proposal).findByRole('alert')).toHaveTextContent(/PDF, JPG or PNG/);
    expect(calls.some((c) => c.url.includes('/upload-url'))).toBe(false);
  });

  /** After the event: the post-event reports are open. */
  function afterEvent(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
    const base = project();
    return project({
      targetDate: addDays(today, -2),
      tasks: base.tasks.map((t) =>
        t.type === 'ACR' || t.type === 'FINANCIAL_REPORT' ? { ...t, status: 'open' } : t,
      ),
      ...overrides,
    });
  }

  it('asks for the Financial Report’s totals before a file is picked, and sends centavos', async () => {
    stored = [afterEvent()];
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    renderAt(`/projects/${PROJECT_ID}`);
    const report = await screen.findByRole(
      'region',
      { name: 'Financial Report' },
      { timeout: 5000 },
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Acting as' }), {
      target: { value: 'Juan Dela Cruz' },
    });
    const pick = within(report).getByRole('button', { name: /Upload file/ });

    fireEvent.click(pick);
    expect(await within(report).findByText('Enter the total income')).toBeInTheDocument();
    expect(within(report).getByText('Enter the total expenses')).toBeInTheDocument();
    expect(click).not.toHaveBeenCalled();

    fireEvent.change(within(report).getByRole('textbox', { name: 'Total income (₱)' }), {
      target: { value: '12,345.50' },
    });
    fireEvent.change(within(report).getByRole('textbox', { name: 'Total expenses (₱)' }), {
      target: { value: '2000' },
    });
    expect(within(report).getByText('₱10,345.50')).toBeInTheDocument();
    fireEvent.click(pick);
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();

    const input = report.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.7'], 'report.pdf')] } });
    await waitFor(() =>
      expect(
        calls.find((c) => c.url.endsWith('/tasks/FINANCIAL_REPORT/documents'))?.body,
      ).toEqual({
        uploadKey: UPLOAD_KEY,
        visibility: 'private',
        actingAs: 'Juan Dela Cruz',
        figures: { incomeCentavos: 1_234_550, expensesCentavos: 200_000 },
      }),
    );
  });

  it('refuses totals that are not amounts', async () => {
    stored = [afterEvent()];
    renderAt(`/projects/${PROJECT_ID}`);
    const report = await screen.findByRole(
      'region',
      { name: 'Financial Report' },
      { timeout: 5000 },
    );
    fireEvent.change(within(report).getByRole('textbox', { name: 'Total income (₱)' }), {
      target: { value: 'about 5k' },
    });
    fireEvent.click(within(report).getByRole('button', { name: /Upload file/ }));
    expect(
      await within(report).findByText('Enter the total income in pesos, e.g. 12,345.50'),
    ).toBeInTheDocument();
  });

  it('shows the saved totals, a loss, and the ISSC’s review', async () => {
    role = 'governing';
    stored = [
      afterEvent({
        financialFigures: {
          incomeCentavos: 100_000,
          expensesCentavos: 350_025,
          netCentavos: -250_025,
          underReview: { remark: 'Receipts do not add up', flaggedAt: '2026-10-12T02:00:00Z' },
          correctableUntil: '2026-12-31T15:59:59.999Z',
          updatedAt: '2026-10-11T02:00:00Z',
        },
      }),
    ];
    renderAt(`/projects/${PROJECT_ID}`);
    const report = await screen.findByRole(
      'region',
      { name: 'Financial Report' },
      { timeout: 5000 },
    );
    expect(within(report).getByText('₱1,000.00')).toBeInTheDocument();
    expect(within(report).getByText('₱3,500.25')).toBeInTheDocument();
    expect(within(report).getByText('−₱2,500.25')).toBeInTheDocument();
    expect(within(report).getByRole('note')).toHaveTextContent(
      /Under review by the ISSC since Oct 12, 2026: “Receipts do not add up”/,
    );
    // A governing body reads the figures but never edits them.
    expect(
      within(report).queryByRole('textbox', { name: 'Total income (₱)' }),
    ).not.toBeInTheDocument();
  });

  it('starts the fields from the saved totals when replacing the report', async () => {
    stored = [
      afterEvent({
        financialFigures: {
          incomeCentavos: 1_234_505,
          expensesCentavos: 0,
          netCentavos: 1_234_505,
          underReview: null,
          correctableUntil: '2026-12-31T15:59:59.999Z',
          updatedAt: '2026-10-11T02:00:00Z',
        },
      }),
    ];
    renderAt(`/projects/${PROJECT_ID}`);
    const report = await screen.findByRole(
      'region',
      { name: 'Financial Report' },
      { timeout: 5000 },
    );
    expect(within(report).getByRole('textbox', { name: 'Total income (₱)' })).toHaveValue(
      '12345.05',
    );
    expect(within(report).getByRole('textbox', { name: 'Total expenses (₱)' })).toHaveValue(
      '0.00',
    );
  });

  it('shows a governing body (its CSC) the checklist without upload controls', async () => {
    role = 'governing';
    renderAt(`/projects/${PROJECT_ID}`);
    const proposal = await screen.findByRole(
      'region',
      { name: 'Project Proposal' },
      { timeout: 5000 },
    );
    expect(within(proposal).queryByRole('button', { name: /Upload/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Acting as' })).not.toBeInTheDocument();
  });

  it('shows not found for a project the API does not return', async () => {
    renderAt('/projects/0195f3c0-0000-7000-8000-0000000000ff');
    expect(
      await screen.findByRole('heading', { name: 'Project not found' }, { timeout: 5000 }),
    ).toBeInTheDocument();
  });
});
