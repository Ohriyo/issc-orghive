import type { ReactNode } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AdminSemester,
  AdminSemestersResponse,
  Disqualification,
  DisqualificationsResponse,
} from '@orghive/shared';
import {
  toDisqualificationRow,
  useAdminDisqualifications,
  type AdminDisqualificationsModel,
} from './presenters/use-admin-disqualifications';
import {
  toSemesterRow,
  useAdminSemesters,
  type AdminSemestersModel,
} from './presenters/use-admin-semesters';
import { DisqualificationsView } from './views/disqualifications-view';
import { SemestersView } from './views/semesters-view';

const fetchMock = vi.fn<typeof fetch>();
const NOW = () => new Date('2026-11-02T04:00:00Z');
const ORG_ID = '0195f3c0-0000-7000-8000-0000000000f2';

const SEMESTER: AdminSemester = {
  academicYear: '2026-2027',
  semester: 'first',
  start: '2026-08-17',
  end: '2026-12-18',
  isSet: true,
  status: 'provisional',
  provisionalUntil: '2026-12-25',
};
const FINAL: AdminSemester = {
  ...SEMESTER,
  academicYear: '2025-2026',
  start: '2025-08-01',
  end: '2025-12-31',
  isSet: false,
  status: 'final',
  provisionalUntil: '2026-01-07',
};
const SEMESTERS: AdminSemestersResponse = { finalAfterDays: 7, semesters: [SEMESTER, FINAL] };

const STANDING: Disqualification = {
  id: '0195f3c0-0000-7000-8000-0000000000f1',
  organization: { id: ORG_ID, name: 'JPICE', acronym: 'JPICE', type: 'SBO' },
  reason: 'The attendance sheets were falsified.',
  actingAs: 'Ana Reyes',
  createdAt: '2026-10-20T02:00:00.000Z',
  lifted: null,
};
const LIFTED: Disqualification = {
  ...STANDING,
  id: '0195f3c0-0000-7000-8000-0000000000f3',
  lifted: { reason: 'Checked again.', actingAs: 'Ben Cruz', at: '2026-10-25T02:00:00.000Z' },
};
const PENALTIES: DisqualificationsResponse = {
  status: 'provisional',
  items: [STANDING, LIFTED],
  organizations: [STANDING.organization],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const writes = () =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT' || init?.method === 'POST');

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('toSemesterRow', () => {
  it('says the dates, where they came from and whether the standings are final', () => {
    expect(toSemesterRow(SEMESTER)).toMatchObject({
      label: '1st semester 2026-2027',
      source: 'Set by the ISSC',
      standing: expect.stringContaining('provisional until Dec 25, 2026') as string,
      locked: false,
    });
    expect(toSemesterRow(FINAL)).toMatchObject({
      source: 'Usual dates',
      standing: 'Standings final',
      locked: true,
    });
  });
});

describe('useAdminSemesters', () => {
  it('asks who is acting, checks the dates, saves and shows what the API says', async () => {
    fetchMock.mockImplementation((input, init) => {
      if (init?.method === 'PUT') return Promise.resolve(json(SEMESTERS));
      if (urlOf(input).includes('/admin/semesters')) return Promise.resolve(json(SEMESTERS));
      return Promise.resolve(json({ semesters: [] }));
    });
    const { result } = renderHook(() => useAdminSemesters(), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    const rows = () => {
      const state = result.current.state;
      return state.status === 'ready' ? state.rows : [];
    };

    act(() => result.current.edit(rows()[0]!));
    expect(result.current.dialog).toMatchObject({
      open: true,
      start: '2026-08-17',
      end: '2026-12-18',
    });

    act(() => result.current.dialog.submit());
    expect(result.current.dialog.actingAs.error).toBeTruthy();
    expect(writes()).toHaveLength(0);

    act(() => result.current.dialog.actingAs.onChange('Ana Reyes'));
    act(() => result.current.dialog.setEnd('2026-08-01'));
    act(() => result.current.dialog.submit());
    expect(result.current.dialog.error).toBe('The last day must be after the first day.');
    expect(writes()).toHaveLength(0);

    act(() => result.current.dialog.setEnd('2026-12-20'));
    act(() => result.current.dialog.submit());
    await waitFor(() => expect(result.current.dialog.open).toBe(false));
    const [url, init] = writes()[0]!;
    expect(urlOf(url)).toContain('/admin/semesters/2026-2027/first');
    expect(JSON.parse(init!.body as string)).toEqual({
      start: '2026-08-17',
      end: '2026-12-20',
      actingAs: 'Ana Reyes',
    });
    expect(result.current.saved).toMatch(/Saved the dates of 1st semester 2026-2027/);
  });

  it('keeps the dialog open with why the API refused', async () => {
    fetchMock.mockImplementation((input, init) => {
      if (init?.method === 'PUT') {
        return Promise.resolve(
          json({ error: { code: 'CONFLICT', message: 'These dates overlap.' } }, 409),
        );
      }
      return Promise.resolve(
        json(urlOf(input).includes('/admin/') ? SEMESTERS : { semesters: [] }),
      );
    });
    const { result } = renderHook(() => useAdminSemesters(), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    act(() => {
      const state = result.current.state;
      if (state.status === 'ready') result.current.edit(state.rows[0]!);
    });
    act(() => result.current.dialog.actingAs.onChange('Ana Reyes'));
    act(() => result.current.dialog.submit());
    await waitFor(() => expect(result.current.dialog.error).toBe('These dates overlap.'));
    expect(result.current.dialog.open).toBe(true);
  });
});

describe('SemestersView', () => {
  const dialog = {
    open: false,
    label: '',
    start: '',
    end: '',
    setStart: vi.fn(),
    setEnd: vi.fn(),
    actingAs: { value: '', onChange: vi.fn(), take: vi.fn() },
    error: null,
    saving: false,
    submit: vi.fn(),
    close: vi.fn(),
  };
  const model = (state: AdminSemestersModel['state']): AdminSemestersModel => ({
    state,
    edit: vi.fn(),
    saved: null,
    dialog,
  });

  it('offers the dates of a provisional semester, and locks a final one', () => {
    const shown = model({
      status: 'ready',
      rows: [toSemesterRow(SEMESTER), toSemesterRow(FINAL)],
      finalAfterDays: 7,
    });
    render(<SemestersView model={shown} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Semesters' })).toBeInTheDocument();
    expect(screen.getByText(/provisional for 7 days/)).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: /Set the dates of/ });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    expect(shown.edit).toHaveBeenCalledOnce();
    expect(screen.getByText(/Standings final/)).toBeInTheDocument();
  });

  it('has loading and error states', () => {
    const retry = vi.fn();
    const { rerender } = render(<SemestersView model={model({ status: 'loading' })} />);
    expect(screen.getByText('Loading the semesters')).toBeInTheDocument();
    rerender(<SemestersView model={model({ status: 'error', retry })} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('asks for both days and who is acting in the dialog', () => {
    render(
      <SemestersView
        model={{
          ...model({ status: 'loading' }),
          dialog: { ...dialog, open: true, label: '1st semester 2026-2027' },
        }}
      />,
    );
    expect(screen.getByRole('dialog')).toHaveTextContent('1st semester 2026-2027');
    expect(screen.getByLabelText('First day')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('Last day')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('Acting as')).toBeInTheDocument();
  });
});

describe('toDisqualificationRow', () => {
  it('names the organization, who decided, and any lifting', () => {
    expect(toDisqualificationRow(STANDING)).toMatchObject({
      organization: 'JPICE (SBO)',
      by: 'By Ana Reyes on Oct 20, 2026',
      lifted: null,
    });
    expect(toDisqualificationRow(LIFTED).lifted).toBe(
      'Lifted by Ben Cruz on Oct 25, 2026: “Checked again.”',
    );
  });
});

describe('useAdminDisqualifications', () => {
  function serve() {
    fetchMock.mockImplementation((input, init) => {
      if (init?.method === 'POST') return Promise.resolve(json(STANDING, 201));
      return Promise.resolve(
        json(urlOf(input).includes('/admin/') ? PENALTIES : { semesters: [] }),
      );
    });
  }

  it('checks the reason and the organization, then disqualifies', async () => {
    serve();
    const { result } = renderHook(() => useAdminDisqualifications(NOW), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(
      fetchMock.mock.calls.some(([input]) =>
        urlOf(input).includes('/admin/disqualifications?academicYear=2026-2027&semester=first'),
      ),
    ).toBe(true);

    act(() => result.current.disqualify());
    expect(result.current.dialog.mode).toBe('disqualify');
    expect(result.current.dialog.organizations).toEqual([{ value: ORG_ID, label: 'JPICE (SBO)' }]);
    act(() => result.current.dialog.actingAs.onChange('Ana Reyes'));
    act(() => result.current.dialog.submit());
    expect(result.current.dialog.error).toBe('Pick an organization');

    act(() => result.current.dialog.setOrganizationId(ORG_ID));
    act(() => result.current.dialog.setReason('short'));
    act(() => result.current.dialog.submit());
    expect(result.current.dialog.error).toBe('Give the reason in a sentence');
    expect(writes()).toHaveLength(0);

    act(() => result.current.dialog.setReason('The attendance sheets were falsified.'));
    act(() => result.current.dialog.submit());
    await waitFor(() => expect(result.current.dialog.mode).toBe(null));
    const [url, init] = writes()[0]!;
    expect(urlOf(url)).toMatch(/\/admin\/disqualifications$/);
    expect(JSON.parse(init!.body as string)).toEqual({
      organizationId: ORG_ID,
      academicYear: '2026-2027',
      semester: 'first',
      reason: 'The attendance sheets were falsified.',
      actingAs: 'Ana Reyes',
    });
  });

  it('lifts one with a reason', async () => {
    serve();
    const { result } = renderHook(() => useAdminDisqualifications(NOW), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    const row = toDisqualificationRow(STANDING);
    act(() => result.current.lift(row));
    expect(result.current.dialog).toMatchObject({ mode: 'lift', organization: 'JPICE (SBO)' });
    act(() => result.current.dialog.actingAs.onChange('Ben Cruz'));
    act(() => result.current.dialog.setReason('The sheets were checked again.'));
    act(() => result.current.dialog.submit());
    await waitFor(() => expect(result.current.dialog.mode).toBe(null));
    const [url, init] = writes()[0]!;
    expect(urlOf(url)).toContain(`/admin/disqualifications/${STANDING.id}/lift`);
    expect(JSON.parse(init!.body as string)).toEqual({
      reason: 'The sheets were checked again.',
      actingAs: 'Ben Cruz',
    });
  });
});

describe('DisqualificationsView', () => {
  const model = (
    state: AdminDisqualificationsModel['state'],
    dialog: Partial<AdminDisqualificationsModel['dialog']> = {},
  ): AdminDisqualificationsModel => ({
    semester: {
      value: '2026-2027:first',
      label: '1st semester 2026–2027',
      options: [{ value: '2026-2027:first', label: '1st semester 2026–2027' }],
    },
    setSemester: vi.fn(),
    state,
    disqualify: vi.fn(),
    lift: vi.fn(),
    dialog: {
      mode: null,
      organization: '',
      organizations: [{ value: ORG_ID, label: 'JPICE (SBO)' }],
      organizationId: '',
      setOrganizationId: vi.fn(),
      reason: '',
      setReason: vi.fn(),
      actingAs: { value: '', onChange: vi.fn(), take: vi.fn() },
      error: null,
      saving: false,
      submit: vi.fn(),
      close: vi.fn(),
      ...dialog,
    },
  });
  const rows = [toDisqualificationRow(STANDING), toDisqualificationRow(LIFTED)];

  it('lists them, offering to lift only a standing one', () => {
    const shown = model({ status: 'ready', final: false, rows });
    render(<DisqualificationsView model={shown} />);
    const lift = screen.getAllByRole('button', { name: /Lift the disqualification of/ });
    expect(lift).toHaveLength(1);
    fireEvent.click(lift[0]!);
    expect(shown.lift).toHaveBeenCalledWith(rows[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Disqualify an organization' }));
    expect(shown.disqualify).toHaveBeenCalledOnce();
    expect(screen.getByText(/Lifted by Ben Cruz/)).toBeInTheDocument();
  });

  it('changes nothing once the standings are final', () => {
    render(<DisqualificationsView model={model({ status: 'ready', final: true, rows })} />);
    expect(screen.getByText(/are final, so nothing here can change/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Lift/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Disqualify an organization' }),
    ).not.toBeInTheDocument();
  });

  it('has empty, loading and error states', () => {
    const retry = vi.fn();
    const { rerender } = render(
      <DisqualificationsView model={model({ status: 'ready', final: false, rows: [] })} />,
    );
    expect(screen.getByText(/No organization was disqualified/)).toBeInTheDocument();
    rerender(<DisqualificationsView model={model({ status: 'loading' })} />);
    expect(screen.getByText('Loading the disqualifications')).toBeInTheDocument();
    rerender(<DisqualificationsView model={model({ status: 'error', retry })} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('asks for the organization, the reason and who is acting', () => {
    render(
      <DisqualificationsView
        model={model({ status: 'ready', final: false, rows: [] }, { mode: 'disqualify' })}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('From the leaderboard of 1st semester 2026–2027');
    expect(screen.getByLabelText('Organization')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Reason/)).toBeInTheDocument();
    expect(screen.getByLabelText('Acting as')).toBeInTheDocument();
  });
});
