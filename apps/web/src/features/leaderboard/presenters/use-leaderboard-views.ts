import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { collegeListResponseSchema, type LeaderboardType, type SemesterKey } from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import {
  BOARD_LABELS,
  parseSemesterValue,
  podiumSignature,
  scoringNote,
  semesterChoices,
  semesterLabel,
  semesterValue,
  splitBoard,
  type StandingView,
} from './leaderboard-model';
import {
  useLeaderboardBoard,
  useLeaderboardLive,
  type LeaderboardBoardModel,
  type LiveState,
} from './use-leaderboard';

/**
 * Counts live changes to a board's Top 3, so the podium can celebrate each one. A change of
 * board or semester (`scope`) and the first load never count: only what moved while the
 * page was open. Stored in state and updated during render, React's pattern for
 * "information from previous renders".
 */
export function useTop3Celebrations(scope: string, signature: string): number {
  const [seen, setSeen] = useState({ scope, signature, bursts: 0 });
  if (seen.scope !== scope || seen.signature !== signature) {
    const moved = seen.scope === scope && seen.signature !== '' && signature !== '';
    setSeen({ scope, signature, bursts: seen.bursts + (moved ? 1 : 0) });
  }
  return seen.bursts;
}

export type BoardState =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | {
      status: 'ready';
      semester: SemesterKey;
      podium: StandingView[];
      list: StandingView[];
      note: string;
      /** Bumped on every live change to the Top 3: play the celebration. */
      bursts: number;
    };

function boardState(model: LeaderboardBoardModel, bursts: number): BoardState {
  if (model.status !== 'ready') return model;
  const { board } = model;
  return {
    status: 'ready',
    semester: { academicYear: board.academicYear, semester: board.semester },
    ...splitBoard(board.rows),
    note: scoringNote(board.latePoints),
    bursts,
  };
}

function useBoardState(
  params: {
    type: LeaderboardType;
    academicYear?: string;
    semester?: SemesterKey['semester'];
    college?: string;
  },
  live: LiveState,
  scope: string,
): BoardState {
  const model = useLeaderboardBoard(params, live);
  const bursts = useTop3Celebrations(
    scope,
    model.status === 'ready' ? podiumSignature(model.board.rows) : '',
  );
  return boardState(model, bursts);
}

export interface HomeLeaderboardModel {
  live: LiveState;
  /** "1st semester 2026–2027", once a board has loaded. */
  semester: string | null;
  boards: Record<LeaderboardType, BoardState>;
  /** Below lg one podium shows at a time; this is it. */
  shown: LeaderboardType;
  show: (type: LeaderboardType) => void;
}

/** The homepage band: both Top 3 podiums of the current semester, live on one stream. */
export function useHomeLeaderboard(): HomeLeaderboardModel {
  const live = useLeaderboardLive();
  const [shown, show] = useState<LeaderboardType>('SBO');
  const boards = {
    SBO: useBoardState({ type: 'SBO' }, live, 'current:SBO'),
    CSC: useBoardState({ type: 'CSC' }, live, 'current:CSC'),
  };
  const ready = [boards.SBO, boards.CSC].find((b) => b.status === 'ready');
  return {
    live,
    semester: ready?.status === 'ready' ? semesterLabel(ready.semester) : null,
    boards,
    shown,
    show,
  };
}

export interface LeaderboardPageModel {
  type: LeaderboardType;
  setType: (type: LeaderboardType) => void;
  semester: { value: string; options: { value: string; label: string }[] };
  setSemester: (value: string) => void;
  /** The SBO board's college filter; null on the CSC board (one CSC per college). */
  college: { value: string; options: { value: string; label: string }[] } | null;
  setCollege: (slug: string) => void;
  live: LiveState;
  board: BoardState;
  /** "Student Body Organizations" or "Collegiate Student Councils". */
  boardLabel: string;
}

const typeOf = (param: string | null): LeaderboardType => (param === 'csc' ? 'CSC' : 'SBO');

/**
 * /leaderboard: one board at a time, its semester and college filter kept in the URL
 * (`?board=csc&semester=2026-2027:first&college=cea`), so a view can be shared and Back
 * returns to it.
 */
export function useLeaderboardPage(now: () => Date = () => new Date()): LeaderboardPageModel {
  const [params, setParams] = useSearchParams();
  const type = typeOf(params.get('board'));
  const picked = parseSemesterValue(params.get('semester'));
  const college = type === 'SBO' ? (params.get('college') ?? undefined) : undefined;

  const semesterParams = picked ?? {};
  const live = useLeaderboardLive(semesterParams);
  const board = useBoardState(
    { type, ...semesterParams, college },
    live,
    `${picked ? semesterValue(picked) : 'current'}:${type}:${college ?? ''}`,
  );

  const colleges = useQuery({
    queryKey: queryKeys.colleges.list,
    queryFn: () => api.get('/colleges', { schema: collegeListResponseSchema }),
    staleTime: 5 * 60_000,
    enabled: type === 'SBO',
  });

  const options = semesterChoices(now());
  const value = picked ? semesterValue(picked) : options[0]!.value;
  // A shared link may name a semester older than the picker lists.
  if (picked && !options.some((o) => o.value === value)) {
    options.push({ value, label: semesterLabel(picked) });
  }

  const update = (changes: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, val] of Object.entries(changes)) {
          if (val) next.set(key, val);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );

  return {
    type,
    setType: (next) => update({ board: next === 'CSC' ? 'csc' : null, college: null }),
    semester: { value, options },
    setSemester: (next) => update({ semester: next === options[0]!.value ? null : next }),
    college:
      type === 'SBO'
        ? {
            value: college ?? '',
            options: (colleges.data?.colleges ?? []).map((c) => ({
              value: c.slug,
              label: c.code,
            })),
          }
        : null,
    setCollege: (slug) => update({ college: slug || null }),
    live,
    board,
    boardLabel: BOARD_LABELS[type].long,
  };
}
