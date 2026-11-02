import { useQuery } from '@tanstack/react-query';
import {
  myStandingResponseSchema,
  PROJECT_TASK_LABELS,
  type MyStanding,
  type StandingHint,
} from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import {
  BOARD_LABELS,
  semesterLabel,
  standingsLabel,
  toStandingView,
  type StandingView,
} from './leaderboard-model';

export interface HintView {
  key: string;
  text: string;
  href: string;
}

/** The reports as officers name them: "the ACR", not "the Activity Completion Report". */
const REPORT_NAMES: Record<StandingHint['missing'][number], string> = {
  ACR: 'ACR',
  FINANCIAL_REPORT: 'Financial Report',
};

/** "Submit the ACR for “Tree Planting” to count it." (docs/LEADERBOARD_PHASES.md, 3.6) */
export function hintText(hint: StandingHint): string {
  const project = `“${hint.projectName}”`;
  if (hint.kind === 'check_figures') {
    return `1 report under review: check the figures for ${project}.`;
  }
  if (hint.kind === 'verify_tasks') {
    // Spec section 6: legacy, flagged, warned or private files hold the project back.
    const tasks = hint.held
      .map((type) => REPORT_NAMES[type as keyof typeof REPORT_NAMES] ?? PROJECT_TASK_LABELS[type])
      .join(' and ');
    return hint.held.length > 1
      ? `The ${tasks} for ${project} don’t count yet: re-upload them on their templates or share them.`
      : `The ${tasks} for ${project} doesn’t count yet: re-upload it on its template or share it.`;
  }
  const reports = hint.missing.map((type) => REPORT_NAMES[type]).join(' and ');
  return `Submit the ${reports} for ${project} to count it.`;
}

export type MyStandingModel =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | {
      status: 'ready';
      /** "1st semester 2026–2027". */
      semester: string;
      /** "Provisional until Dec 25, 2026, then final." */
      finality: string;
      /** The ISSC's reason when it disqualified the organization this semester (spec 5B). */
      disqualifiedFor: string | null;
      /** "Student Body Organizations". */
      board: string;
      /** Its row; null while it has no implemented project. */
      standing: StandingView | null;
      /** Beside the rank: "of 12 Student Body Organizations". */
      outOf: string;
      hints: HintView[];
      leaderboardHref: string;
    };

export function toMyStandingModel(
  standing: MyStanding,
): Extract<MyStandingModel, { status: 'ready' }> {
  const row = standing.row && toStandingView(standing.row);
  return {
    status: 'ready',
    semester: semesterLabel(standing),
    finality: standingsLabel(standing.status, standing.provisionalUntil),
    disqualifiedFor: standing.disqualifiedFor,
    board: BOARD_LABELS[standing.type].long,
    standing: row,
    outOf: `of ${standing.boardSize} ${BOARD_LABELS[standing.type].long}`,
    hints: standing.hints.map((hint) => ({
      key: `${hint.kind}:${hint.projectId}`,
      text: hintText(hint),
      href: `/projects/${hint.projectId}`,
    })),
    leaderboardHref: standing.type === 'CSC' ? '/leaderboard?board=csc' : '/leaderboard',
  };
}

/**
 * The dashboard's leaderboard card: the account's own rank this semester and what would
 * move it up. Off for the ISSC, which is never ranked (the API answers `standing: null`).
 */
export function useMyStanding(enabled: boolean): MyStandingModel {
  const query = useQuery({
    queryKey: queryKeys.myStanding,
    queryFn: () => api.get('/me/leaderboard', { schema: myStandingResponseSchema }),
    enabled,
    staleTime: 60_000,
  });
  if (!enabled) return { status: 'off' };
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  if (!query.data) return { status: 'loading' };
  if (!query.data.standing) return { status: 'off' };
  return toMyStandingModel(query.data.standing);
}
