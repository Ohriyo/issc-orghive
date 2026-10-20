import { useEffect, useState } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  LEADERBOARD_STANDINGS_EVENT,
  leaderboardEventSchema,
  leaderboardResponseSchema,
  type LeaderboardEvent,
  type LeaderboardResponse,
  type LeaderboardType,
  type Semester,
} from '@orghive/shared';
import { api, apiUrl } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

/**
 * How fresh the boards are: `live` while the stream is open, `reconnecting` while the browser
 * retries it, `polling` once it gave up (refused, unsupported, or failed too often).
 */
export type LiveState = 'connecting' | 'live' | 'reconnecting' | 'polling';

export interface SemesterParams {
  /** With `semester`; both omitted means the current semester. */
  academicYear?: string;
  semester?: Semester;
}

export interface LeaderboardParams extends SemesterParams {
  type: LeaderboardType;
  /** A college's slug: only its organizations, each keeping its rank on the board. */
  college?: string;
}

/** Without the stream, the boards are fetched again this often. */
export const POLL_MS = 60_000;
/** Stream failures in a row (without one successful open) before polling instead. */
export const MAX_STREAM_FAILURES = 3;

/** `2026-2027:first`, or `current`: how the boards of one semester are keyed. */
export function semesterKeyOf({ academicYear, semester }: SemesterParams): string {
  return academicYear && semester ? `${academicYear}:${semester}` : 'current';
}

function queryString(params: Record<string, string | undefined>): string {
  const defined = Object.entries(params).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  return defined.length > 0 ? `?${new URLSearchParams(defined).toString()}` : '';
}

/**
 * A stream event carries both whole boards: every cached board of its semester is replaced,
 * filtered by college as that board was asked for.
 */
export function applyStandings(client: QueryClient, semesterKey: string, event: LeaderboardEvent) {
  const cached = client
    .getQueryCache()
    .findAll({ queryKey: queryKeys.leaderboard.semester(semesterKey) });
  for (const query of cached) {
    const [, , type, college] = query.queryKey as ReturnType<typeof queryKeys.leaderboard.board>;
    const rows = event.boards[type as LeaderboardType];
    if (!rows) continue;
    client.setQueryData<LeaderboardResponse>(query.queryKey, {
      academicYear: event.academicYear,
      semester: event.semester,
      latePoints: event.latePoints,
      type: type as LeaderboardType,
      rows: college ? rows.filter((row) => row.college?.slug === college) : rows,
    });
  }
}

const streamSupported = () => typeof EventSource !== 'undefined';

/**
 * Keeps every cached board of a semester live over Server-Sent Events. The browser
 * reconnects a dropped stream by itself (the server's `retry` is 5 s) and the server sends
 * the whole boards again on connect. A refused stream (429 past the connection limits), or
 * MAX_STREAM_FAILURES failures in a row, switches to polling for as long as the page stays.
 * Use it once per page; the homepage's two podiums share one stream.
 */
export function useLeaderboardLive(params: SemesterParams = {}): LiveState {
  const client = useQueryClient();
  const semesterKey = semesterKeyOf(params);
  // Keyed by semester, so switching semesters starts from `connecting` again.
  const [state, setState] = useState<{ key: string; live: LiveState }>({
    key: semesterKey,
    live: 'connecting',
  });

  useEffect(() => {
    if (!streamSupported()) return;
    const set = (live: LiveState) => setState({ key: semesterKey, live });
    const source = new EventSource(
      apiUrl(
        `/leaderboard/stream${queryString({ academicYear: params.academicYear, semester: params.semester })}`,
      ),
    );
    let failures = 0;
    source.addEventListener('open', () => {
      failures = 0;
      set('live');
    });
    source.addEventListener(LEADERBOARD_STANDINGS_EVENT, (event: MessageEvent<string>) => {
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      const parsed = leaderboardEventSchema.safeParse(data);
      if (parsed.success) applyStandings(client, semesterKey, parsed.data);
    });
    source.addEventListener('error', () => {
      failures += 1;
      if (source.readyState === EventSource.CLOSED || failures >= MAX_STREAM_FAILURES) {
        source.close();
        set('polling');
      } else {
        set('reconnecting');
      }
    });
    return () => source.close();
  }, [client, semesterKey, params.academicYear, params.semester]);

  if (!streamSupported()) return 'polling';
  return state.key === semesterKey ? state.live : 'connecting';
}

export type LeaderboardBoardModel =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; board: LeaderboardResponse };

/** One board (SBO or CSC). Polls only while `live` is `polling`; otherwise the stream feeds it. */
export function useLeaderboardBoard(
  params: LeaderboardParams,
  live: LiveState,
): LeaderboardBoardModel {
  const semesterKey = semesterKeyOf(params);
  const query = useQuery({
    queryKey: queryKeys.leaderboard.board(semesterKey, params.type, params.college ?? null),
    // A public read: background, so it never counts as session activity.
    queryFn: () =>
      api.get(
        `/leaderboard${queryString({
          type: params.type,
          academicYear: params.academicYear,
          semester: params.semester,
          college: params.college,
        })}`,
        { schema: leaderboardResponseSchema, background: true },
      ),
    staleTime: POLL_MS,
    refetchInterval: live === 'polling' ? POLL_MS : false,
  });

  if (query.data) return { status: 'ready', board: query.data };
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  return { status: 'loading' };
}

/** One live board: what /leaderboard shows for its selected tab. */
export function useLeaderboard(
  params: LeaderboardParams,
): LeaderboardBoardModel & { live: LiveState } {
  const live = useLeaderboardLive(params);
  return { ...useLeaderboardBoard(params, live), live };
}
