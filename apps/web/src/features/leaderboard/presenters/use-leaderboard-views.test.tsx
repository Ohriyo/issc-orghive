import { useEffect, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollegeListResponse, LeaderboardResponse, MyStanding } from '@orghive/shared';
import { lbRow, LB_SEMESTER } from '@/test/leaderboard';
import { hintText, toMyStandingModel } from './use-my-standing';
import { useLeaderboardPage, useTop3Celebrations } from './use-leaderboard-views';

const fetchMock = vi.fn<typeof fetch>();

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}
const NOW = () => new Date('2026-10-20T04:00:00Z');

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

const COLLEGES: CollegeListResponse = {
  colleges: [
    {
      code: 'CEA',
      slug: 'cea',
      name: 'College of Engineering and Architecture',
      motto: null,
      csc: null,
    },
  ],
};

function board(type: 'SBO' | 'CSC', rows = [lbRow('jpice', 1)]): LeaderboardResponse {
  return { ...LB_SEMESTER, latePoints: 0.5, type, rows };
}

/** The URL's query string, as the router last rendered it. */
const location = { search: '' };
function wrapper(initial = '/leaderboard') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Spy() {
    const { search } = useLocation();
    useEffect(() => {
      location.search = search;
    });
    return null;
  }
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        {children}
        <Spy />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', undefined);
  fetchMock.mockImplementation((input) => {
    const url = urlOf(input);
    if (url.includes('/colleges')) return Promise.resolve(json(COLLEGES));
    return Promise.resolve(json(board(url.includes('type=CSC') ? 'CSC' : 'SBO')));
  });
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('useTop3Celebrations', () => {
  it('counts live changes to the Top 3, never the first load or a change of board', () => {
    const { result, rerender } = renderHook(
      ({ scope, signature }: { scope: string; signature: string | null }) =>
        useTop3Celebrations(scope, signature),
      { initialProps: { scope: 'SBO', signature: null as string | null } },
    );
    rerender({ scope: 'SBO', signature: 'a,b,c' });
    expect(result.current).toBe(0);
    rerender({ scope: 'SBO', signature: 'b,a,c' });
    expect(result.current).toBe(1);
    rerender({ scope: 'CSC', signature: 'x,y,z' });
    expect(result.current).toBe(1);
    rerender({ scope: 'CSC', signature: 'x,y,z' });
    expect(result.current).toBe(1);
  });

  it('celebrates the first organization to reach an empty podium, not the podium emptying', () => {
    const { result, rerender } = renderHook(
      ({ signature }: { signature: string | null }) => useTop3Celebrations('SBO', signature),
      { initialProps: { signature: null as string | null } },
    );
    // Loaded with nobody ranked yet: nothing to celebrate.
    rerender({ signature: '' });
    expect(result.current).toBe(0);
    rerender({ signature: 'jpice' });
    expect(result.current).toBe(1);
    rerender({ signature: '' });
    expect(result.current).toBe(1);
  });
});

describe('useLeaderboardPage', () => {
  it('opens on the current semester’s SBO board, with the college filter', async () => {
    const { result } = renderHook(() => useLeaderboardPage(NOW), { wrapper: wrapper() });
    expect(result.current.type).toBe('SBO');
    expect(result.current.semester.value).toBe('2026-2027:first');
    expect(result.current.live).toBe('polling');
    await waitFor(() => expect(result.current.board.status).toBe('ready'));
    await waitFor(() =>
      expect(result.current.college?.options).toEqual([{ value: 'cea', label: 'CEA' }]),
    );
    expect(result.current.boardLabel).toBe('Student Body Organizations');
  });

  it('keeps the board, semester and college in the URL', async () => {
    const { result } = renderHook(() => useLeaderboardPage(NOW), { wrapper: wrapper() });
    act(() => result.current.setCollege('cea'));
    expect(location.search).toBe('?college=cea');
    act(() => result.current.setSemester('2025-2026:second'));
    expect(new URLSearchParams(location.search).get('semester')).toBe('2025-2026:second');
    // The CSC board has no college filter, so switching drops it.
    act(() => result.current.setType('CSC'));
    expect(new URLSearchParams(location.search).get('board')).toBe('csc');
    expect(new URLSearchParams(location.search).get('college')).toBeNull();
    expect(result.current.college).toBeNull();
    await waitFor(() => expect(result.current.board.status).toBe('ready'));
    expect(urlOf(fetchMock.mock.calls.at(-1)![0])).toContain(
      'type=CSC&academicYear=2025-2026&semester=second',
    );
  });

  it('lists a shared semester older than the picker offers', () => {
    const { result } = renderHook(() => useLeaderboardPage(NOW), {
      wrapper: wrapper('/leaderboard?semester=2020-2021:first'),
    });
    expect(result.current.semester.options.at(-1)).toEqual({
      value: '2020-2021:first',
      label: '1st semester 2020–2021',
    });
  });
});

describe('the dashboard standing', () => {
  it('words each hint as the officers name the reports', () => {
    const base = {
      projectId: '0195f3c0-0000-7000-8000-0000000000c3',
      projectName: 'Tree Planting',
    };
    expect(hintText({ ...base, kind: 'submit_reports', missing: ['ACR'] })).toBe(
      'Submit the ACR for “Tree Planting” to count it.',
    );
    expect(
      hintText({ ...base, kind: 'submit_reports', missing: ['ACR', 'FINANCIAL_REPORT'] }),
    ).toBe('Submit the ACR and Financial Report for “Tree Planting” to count it.');
    expect(hintText({ ...base, kind: 'check_figures', missing: [] })).toBe(
      '1 report under review: check the figures for “Tree Planting”.',
    );
  });

  it('shapes the rank, board size and links', () => {
    const standing: MyStanding = {
      ...LB_SEMESTER,
      latePoints: 0.5,
      type: 'CSC',
      boardSize: 7,
      row: lbRow('csc-cea', 2),
      hints: [
        {
          kind: 'check_figures',
          projectId: '0195f3c0-0000-7000-8000-0000000000c3',
          projectName: 'Tree Planting',
          missing: [],
        },
      ],
    };
    expect(toMyStandingModel(standing)).toMatchObject({
      semester: '1st semester 2026–2027',
      board: 'Collegiate Student Councils',
      outOf: 'of 7 Collegiate Student Councils',
      standing: { rank: 2, medal: 'silver' },
      hints: [{ href: '/projects/0195f3c0-0000-7000-8000-0000000000c3' }],
      leaderboardHref: '/leaderboard?board=csc',
    });
    expect(toMyStandingModel({ ...standing, row: null }).standing).toBeNull();
  });
});
