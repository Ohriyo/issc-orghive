import type { ReactNode } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinancialFiguresListItem } from '@orghive/shared';
import {
  sortRows,
  toFiguresRow,
  useAdminFigures,
  type AdminFiguresModel,
} from './presenters/use-admin-figures';
import { FiguresView } from './views/figures-view';

const fetchMock = vi.fn<typeof fetch>();
const NOW = () => new Date('2026-10-20T04:00:00Z');

function item(
  projectName: string,
  acronym: string,
  review: FinancialFiguresListItem['underReview'] = null,
): FinancialFiguresListItem {
  return {
    projectId: `0195f3c0-0000-7000-8000-0000000000${projectName.length.toString().padStart(2, '0')}`,
    projectName,
    targetDate: '2026-09-20',
    organization: { slug: acronym.toLowerCase(), acronym, name: acronym },
    incomeCentavos: 500_000,
    expensesCentavos: 623_400,
    netCentavos: -123_400,
    underReview: review,
    updatedAt: '2026-10-01T02:00:00.000Z',
  };
}

const FLAGGED = item('Tree Planting', 'JPICE', {
  remark: 'Receipts do not add up',
  flaggedAt: '2026-10-10T02:00:00.000Z',
});
const CLEAN = item('Bridge', 'PSME');

function json(body: unknown, status = 200) {
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

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('figures rows', () => {
  it('shows the amounts in pesos and the review', () => {
    expect(toFiguresRow(FLAGGED)).toMatchObject({
      org: 'JPICE',
      net: '−₱1,234.00',
      negative: true,
      review: { remark: 'Receipts do not add up' },
      projectHref: `/projects/${FLAGGED.projectId}`,
    });
  });

  it('lists the reports under review first', () => {
    expect(sortRows([CLEAN, FLAGGED].map(toFiguresRow)).map((r) => r.org)).toEqual([
      'JPICE',
      'PSME',
    ]);
  });
});

describe('useAdminFigures', () => {
  it('loads the semester, checks the remark, then puts the figures under review', async () => {
    fetchMock.mockImplementation((input, init) => {
      if (init?.method === 'PUT') return Promise.resolve(json({}));
      return Promise.resolve(json({ items: [CLEAN] }));
    });
    const { result } = renderHook(() => useAdminFigures(NOW), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(urlOf(fetchMock.mock.calls[0]![0])).toContain(
      '/admin/financial-figures?academicYear=2026-2027&semester=first',
    );

    const row = result.current.state.status === 'ready' ? result.current.state.rows[0]! : null;
    act(() => result.current.flag(row!));
    expect(result.current.dialog.open).toBe(true);
    act(() => result.current.dialog.submit());
    expect(result.current.dialog.error).toBe('Say what needs checking');

    act(() => result.current.dialog.setRemark('Receipts do not add up'));
    act(() => result.current.dialog.submit());
    await waitFor(() => expect(result.current.dialog.open).toBe(false));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(urlOf(put[0])).toContain(`/admin/projects/${CLEAN.projectId}/financial-figures/flag`);
    expect(JSON.parse(put[1]!.body as string)).toEqual({ remark: 'Receipts do not add up' });
  });

  it('clears a review', async () => {
    fetchMock.mockImplementation((_input, init) =>
      Promise.resolve(init?.method === 'DELETE' ? json({}) : json({ items: [FLAGGED] })),
    );
    const { result } = renderHook(() => useAdminFigures(NOW), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    const row = result.current.state.status === 'ready' ? result.current.state.rows[0]! : null;
    act(() => result.current.clear(row!));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true),
    );
  });
});

describe('FiguresView', () => {
  function model(overrides: Partial<AdminFiguresModel> = {}): AdminFiguresModel {
    return {
      semester: {
        value: '2026-2027:first',
        label: '1st semester 2026–2027',
        options: [{ value: '2026-2027:first', label: '1st semester 2026–2027' }],
      },
      setSemester: vi.fn(),
      state: { status: 'ready', rows: [FLAGGED, CLEAN].map(toFiguresRow), underReview: 1 },
      flag: vi.fn(),
      clear: vi.fn(),
      clearing: null,
      dialog: {
        open: false,
        projectName: '',
        remark: '',
        setRemark: vi.fn(),
        error: null,
        saving: false,
        submit: vi.fn(),
        close: vi.fn(),
      },
      ...overrides,
    };
  }

  it('lists the figures with the review, and the actions for each', () => {
    const m = model();
    render(
      <MemoryRouter>
        <FiguresView model={m} />
      </MemoryRouter>,
    );
    expect(screen.getByText('2 reports, 1 under review')).toBeInTheDocument();
    expect(screen.getByText(/Receipts do not add up/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear review' }));
    expect(m.clear).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Put under review' }));
    expect(m.flag).toHaveBeenCalled();
  });

  it('has empty and error states', () => {
    const retry = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <FiguresView model={model({ state: { status: 'ready', rows: [], underReview: 0 } })} />
      </MemoryRouter>,
    );
    expect(
      screen.getByText('No Financial Report has been submitted for 1st semester 2026–2027 yet.'),
    ).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <FiguresView model={model({ state: { status: 'error', retry } })} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(retry).toHaveBeenCalled();
  });

  it('asks for the remark in a dialog', () => {
    const m = model({
      dialog: { ...model().dialog, open: true, projectName: 'PSME: Bridge', remark: 'Check' },
    });
    render(
      <MemoryRouter>
        <FiguresView model={m} />
      </MemoryRouter>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Put the figures under review' });
    expect(dialog).toHaveTextContent('PSME: Bridge');
    fireEvent.click(screen.getAllByRole('button', { name: 'Put under review' }).at(-1)!);
    expect(m.dialog.submit).toHaveBeenCalled();
  });
});
