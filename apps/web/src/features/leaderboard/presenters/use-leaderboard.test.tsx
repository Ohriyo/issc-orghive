import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeaderboardEvent, LeaderboardResponse, PublicLeaderboardRow } from '@orghive/shared';
import { queryKeys } from '@/lib/query-keys';
import {
  applyStandings,
  MAX_STREAM_FAILURES,
  POLL_MS,
  semesterKeyOf,
  useLeaderboard,
  useLeaderboardBoard,
  useLeaderboardLive,
} from './use-leaderboard';

/** Stands in for the browser's EventSource; tests drive it by hand. */
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  private listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }

  emit(type: string, data = '') {
    if (type === 'open') this.readyState = FakeEventSource.OPEN;
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data }));
    }
  }

  /** A failure the browser retries (readyState CONNECTING) or gives up on (CLOSED). */
  fail(fatal = false) {
    this.readyState = fatal ? FakeEventSource.CLOSED : FakeEventSource.CONNECTING;
    this.emit('error');
  }
}

const fetchMock = vi.fn<typeof fetch>();

function row(slug: string, rank: number, college: string): PublicLeaderboardRow {
  return {
    rank,
    rankChange: null,
    points: 1,
    implementedCount: 1,
    lateCount: 0,
    netProfitCentavos: 10_000,
    underReviewCount: 0,
    organization: {
      type: 'SBO',
      slug,
      acronym: slug.toUpperCase(),
      name: slug,
      logoUrl: null,
      logoSrcSet: null,
    },
    college: { code: college.toUpperCase(), slug: college, name: college },
  };
}

const SEMESTER = { academicYear: '2026-2027', semester: 'first' as const };

function response(rows: PublicLeaderboardRow[], type: 'SBO' | 'CSC' = 'SBO'): LeaderboardResponse {
  return { ...SEMESTER, type, latePoints: 0.5, rows };
}

function event(sbo: PublicLeaderboardRow[], csc: PublicLeaderboardRow[] = []): LeaderboardEvent {
  return { ...SEMESTER, latePoints: 0.5, boards: { SBO: sbo, CSC: csc } };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const stream = () => FakeEventSource.instances.at(-1)!;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  FakeEventSource.instances = [];
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('semesterKeyOf', () => {
  it('keys a named semester, or the current one', () => {
    expect(semesterKeyOf(SEMESTER)).toBe('2026-2027:first');
    expect(semesterKeyOf({})).toBe('current');
  });
});

describe('applyStandings', () => {
  it('replaces every cached board of the semester, filtered as each was asked for', () => {
    const key = semesterKeyOf(SEMESTER);
    client.setQueryData(queryKeys.leaderboard.board(key, 'SBO', null), response([]));
    client.setQueryData(queryKeys.leaderboard.board(key, 'SBO', 'cea'), response([]));
    client.setQueryData(queryKeys.leaderboard.board(key, 'CSC', null), response([], 'CSC'));
    client.setQueryData(queryKeys.leaderboard.board('current', 'SBO', null), response([]));

    const sbo = [row('jpice', 1, 'cea'), row('jpcs', 2, 'ccis')];
    applyStandings(client, key, event(sbo, [row('csc-cea', 1, 'cea')]));

    const read = (type: string, college: string | null, semester = key) =>
      client.getQueryData<LeaderboardResponse>(
        queryKeys.leaderboard.board(semester, type, college),
      );
    expect(read('SBO', null)?.rows.map((r) => r.organization.slug)).toEqual(['jpice', 'jpcs']);
    // The college filter keeps each row's rank on the whole board.
    expect(read('SBO', 'cea')?.rows.map((r) => [r.organization.slug, r.rank])).toEqual([
      ['jpice', 1],
    ]);
    expect(read('CSC', null)?.type).toBe('CSC');
    expect(read('CSC', null)?.rows).toHaveLength(1);
    // Another semester's boards are left alone.
    expect(read('SBO', null, 'current')?.rows).toEqual([]);
  });
});

describe('useLeaderboard', () => {
  it('loads the board, then follows the stream', async () => {
    fetchMock.mockResolvedValue(json(response([row('jpice', 1, 'cea')])));
    const { result } = renderHook(() => useLeaderboard({ type: 'SBO', ...SEMESTER }), {
      wrapper,
    });
    expect(result.current).toMatchObject({ status: 'loading', live: 'connecting' });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/leaderboard?type=SBO&academicYear=2026-2027&semester=first');
    expect(stream().url).toBe('/api/v1/leaderboard/stream?academicYear=2026-2027&semester=first');

    act(() => stream().emit('open'));
    expect(result.current.live).toBe('live');

    act(() =>
      stream().emit(
        'standings',
        JSON.stringify(event([row('jpcs', 1, 'ccis'), row('jpice', 2, 'cea')])),
      ),
    );
    await waitFor(() =>
      expect(
        result.current.status === 'ready' && result.current.board.rows[0]?.organization.slug,
      ).toBe('jpcs'),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores an unreadable event', async () => {
    fetchMock.mockResolvedValue(json(response([row('jpice', 1, 'cea')])));
    const { result } = renderHook(() => useLeaderboard({ type: 'SBO' }), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => stream().emit('standings', 'not json'));
    act(() => stream().emit('standings', JSON.stringify({ boards: 'nope' })));
    expect(result.current.status === 'ready' && result.current.board.rows).toHaveLength(1);
  });

  it('shows an error with a retry', async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 'X', message: 'down' } }, 500));
    const { result } = renderHook(() => useLeaderboard({ type: 'CSC' }), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('error'));
  });
});

describe('useLeaderboardLive', () => {
  it('reconnects a dropped stream, then polls after repeated failures', () => {
    const { result } = renderHook(() => useLeaderboardLive(), { wrapper });
    act(() => stream().emit('open'));
    act(() => stream().fail());
    expect(result.current).toBe('reconnecting');
    // A successful reconnect resets the count.
    act(() => stream().emit('open'));
    expect(result.current).toBe('live');
    for (let i = 1; i < MAX_STREAM_FAILURES; i += 1) {
      act(() => stream().fail());
      expect(result.current).toBe('reconnecting');
    }
    act(() => stream().fail());
    expect(result.current).toBe('polling');
    expect(stream().readyState).toBe(FakeEventSource.CLOSED);
  });

  it('polls at once when the server refuses the stream (429)', () => {
    const { result } = renderHook(() => useLeaderboardLive(), { wrapper });
    act(() => stream().fail(true));
    expect(result.current).toBe('polling');
  });

  it('polls when the browser has no EventSource', () => {
    vi.stubGlobal('EventSource', undefined);
    const { result } = renderHook(() => useLeaderboardLive(), { wrapper });
    expect(result.current).toBe('polling');
  });

  it('closes the stream on unmount and opens a new one for another semester', () => {
    const { rerender, unmount, result } = renderHook(
      (params: { academicYear?: string; semester?: 'first' | 'second' }) =>
        useLeaderboardLive(params),
      { wrapper, initialProps: {} },
    );
    const first = stream();
    act(() => first.emit('open'));
    rerender(SEMESTER);
    expect(first.readyState).toBe(FakeEventSource.CLOSED);
    expect(result.current).toBe('connecting');
    expect(FakeEventSource.instances).toHaveLength(2);
    unmount();
    expect(stream().readyState).toBe(FakeEventSource.CLOSED);
  });
});

describe('useLeaderboardBoard', () => {
  it('polls every minute while polling, and not while live', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockImplementation(() => Promise.resolve(json(response([]))));
    const { rerender } = renderHook(
      (live: 'live' | 'polling') => useLeaderboardBoard({ type: 'SBO' }, live),
      { wrapper, initialProps: 'live' as 'live' | 'polling' },
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 2));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender('polling');
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
