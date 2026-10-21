import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as MotionModule from '@/components/motion';
import { lbRow } from '@/test/leaderboard';
import { LeaderboardBand } from '@/features/home/views/leaderboard-band';
import { splitBoard, toStandingView } from '../presenters/leaderboard-model';
import type { MyStandingModel } from '../presenters/use-my-standing';
import type {
  BoardState,
  HomeLeaderboardModel,
  LeaderboardPageModel,
} from '../presenters/use-leaderboard-views';
import { LeaderboardView } from './leaderboard-view';
import { Podium } from './podium';
import { StandingCard } from './standing-card';
import { StandingsList } from './standings-list';

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('@/components/motion', async (importOriginal) => ({
  ...(await importOriginal<typeof MotionModule>()),
  usePrefersReducedMotion: () => motion.reduced,
}));

beforeEach(() => {
  motion.reduced = false;
});

const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

const TOP3 = splitBoard([
  lbRow('iecep', 1, { underReviewCount: 1 }),
  lbRow('psme', 2, { netProfitCentavos: -123_400 }),
  lbRow('jpice', 3),
]).podium;

describe('Podium', () => {
  it('stands the Top 3 in rank order, each linking to its organization', () => {
    inRouter(<Podium entries={TOP3} label="Top 3 Student Body Organizations" bursts={0} />);
    const list = screen.getByRole('list', { name: 'Top 3 Student Body Organizations' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByText('Rank')).toBeInTheDocument();
    expect(within(items[0]!).getByRole('link', { name: /IECEP/ })).toHaveAttribute(
      'href',
      '/orgs/iecep',
    );
    expect(within(items[0]!).getByText('(1 report under review)')).toBeInTheDocument();
    expect(within(items[1]!).getByText(/−₱1,234\.00/)).toHaveClass('text-destructive');
  });

  it('gives each a medal band with the shimmer, and the #1 the laurel', () => {
    const { container } = inRouter(<Podium entries={TOP3} label="Top 3" bursts={0} />);
    expect(screen.getAllByTestId('hex-shimmer')).toHaveLength(3);
    expect(container.querySelector('.bg-medal-gold-band')).not.toBeNull();
    expect(container.querySelector('.bg-medal-silver-band')).not.toBeNull();
    expect(container.querySelector('.bg-medal-bronze-band')).not.toBeNull();
    expect(container.querySelectorAll('svg[viewBox="0 0 120 48"]')).toHaveLength(1);
  });

  it('bursts confetti on a live change, and not with reduced motion', () => {
    const { rerender } = inRouter(<Podium entries={TOP3} label="Top 3" bursts={0} />);
    expect(screen.queryByTestId('confetti')).toBeNull();
    rerender(
      <MemoryRouter>
        <Podium entries={TOP3} label="Top 3" bursts={1} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('confetti')).toBeInTheDocument();

    motion.reduced = true;
    rerender(
      <MemoryRouter>
        <Podium entries={TOP3} label="Top 3" bursts={2} />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('confetti')).toBeNull();
  });
});

describe('StandingsList', () => {
  it('numbers the rows from 4 with their change, breakdown and profit', () => {
    const rows = [lbRow('uapsa', 4, { rankChange: 2 }), lbRow('jpcs', 5, { rankChange: null })].map(
      toStandingView,
    );
    inRouter(<StandingsList rows={rows} label="Ranked 4 and below" start={4} />);
    const list = screen.getByRole('list', { name: 'Ranked 4 and below' });
    expect(list).toHaveAttribute('start', '4');
    expect(screen.getByText('Up 2 places since the last change')).toBeInTheDocument();
    expect(screen.getByText('New on the board')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'UAPSA' })).toHaveAttribute('href', '/orgs/uapsa');
    expect(screen.getAllByText('1 pt · 1 project')).toHaveLength(2);
  });

  it('renders nothing without rows', () => {
    const { container } = inRouter(<StandingsList rows={[]} label="x" start={1} />);
    expect(container.querySelector('ol')).toBeNull();
  });
});

function page(
  board: BoardState,
  overrides: Partial<LeaderboardPageModel> = {},
): LeaderboardPageModel {
  return {
    type: 'SBO',
    setType: vi.fn(),
    semester: {
      value: '2026-2027:first',
      options: [{ value: '2026-2027:first', label: '1st semester 2026–2027' }],
    },
    setSemester: vi.fn(),
    college: { value: '', options: [{ value: 'cea', label: 'CEA' }] },
    setCollege: vi.fn(),
    live: 'live',
    board,
    boardLabel: 'Student Body Organizations',
    ...overrides,
  };
}

const READY: Extract<BoardState, { status: 'ready' }> = {
  status: 'ready',
  semester: { academicYear: '2026-2027', semester: 'first' },
  ...splitBoard([lbRow('iecep', 1), lbRow('psme', 2), lbRow('jpice', 3), lbRow('uapsa', 4)]),
  note: 'Ranked by points (1 per implemented project, 0.5 if any of its reports was late), then by net profit reported in submitted Financial Reports.',
  bursts: 0,
};

describe('LeaderboardView', () => {
  it('shows the podium, the rest of the board, the Live state and the scoring note', () => {
    inRouter(<LeaderboardView model={page(READY)} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Leaderboard' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Live');
    expect(
      screen.getByRole('list', { name: 'Top 3 Student Body Organizations' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('list', { name: 'Student Body Organizations ranked 4 and below' }),
    ).toBeInTheDocument();
    expect(screen.getByText(READY.note)).toBeInTheDocument();
  });

  it('switches boards with the SBO and CSC tabs (no combined board)', () => {
    const model = page(READY);
    inRouter(<LeaderboardView model={model} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'SBO (Student Body Organizations)',
      'CSC (Collegiate Student Councils)',
    ]);
    fireEvent.mouseDown(tabs[1]!, { button: 0 });
    expect(model.setType).toHaveBeenCalledWith('CSC');
  });

  it('filters by college and picks a semester', () => {
    const model = page(READY);
    inRouter(<LeaderboardView model={model} />);
    fireEvent.change(screen.getByLabelText('College'), { target: { value: 'cea' } });
    expect(model.setCollege).toHaveBeenCalledWith('cea');
    expect(screen.getByLabelText('Semester')).toHaveValue('2026-2027:first');
  });

  it('hides the college filter on the CSC board', () => {
    inRouter(<LeaderboardView model={page(READY, { type: 'CSC', college: null })} />);
    expect(screen.queryByLabelText('College')).toBeNull();
  });

  it('has loading, error and empty states', () => {
    const retry = vi.fn();
    const { unmount } = inRouter(<LeaderboardView model={page({ status: 'loading' })} />);
    expect(screen.getByText('Loading the leaderboard')).toBeInTheDocument();
    unmount();

    const second = inRouter(<LeaderboardView model={page({ status: 'error', retry })} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(retry).toHaveBeenCalled();
    second.unmount();

    const empty: BoardState = { ...READY, podium: [], list: [] };
    const third = inRouter(<LeaderboardView model={page(empty)} />);
    expect(
      screen.getByText('Rankings appear once organizations complete their first projects'),
    ).toBeInTheDocument();
    third.unmount();

    inRouter(<LeaderboardView model={page(empty, { college: { value: 'cea', options: [] } })} />);
    expect(screen.getByText('No organization of this college is ranked yet')).toBeInTheDocument();
  });
});

describe('LeaderboardBand', () => {
  function band(overrides: Partial<HomeLeaderboardModel> = {}): HomeLeaderboardModel {
    return {
      live: 'polling',
      semester: '1st semester 2026–2027',
      boards: { SBO: READY, CSC: { ...READY, podium: [], list: [] } },
      shown: 'SBO',
      show: vi.fn(),
      ...overrides,
    };
  }

  it('shows both podiums, with a toggle for small screens and a link to the full board', () => {
    const model = band();
    inRouter(<LeaderboardBand model={model} />);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Top Organizations this Semester' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Updates every minute');
    const sbo = screen.getByRole('button', { name: /^SBO/ });
    expect(sbo).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /^CSC/ }));
    expect(model.show).toHaveBeenCalledWith('CSC');
    // The CSC board has nobody yet.
    expect(
      screen.getByText('Rankings appear once organizations complete their first projects'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View full leaderboard →' })).toHaveAttribute(
      'href',
      '/leaderboard',
    );
  });
});

describe('StandingCard', () => {
  const ready = (
    overrides: Partial<Extract<MyStandingModel, { status: 'ready' }>> = {},
  ): MyStandingModel => ({
    status: 'ready',
    semester: '1st semester 2026–2027',
    board: 'Student Body Organizations',
    standing: toStandingView(lbRow('jpice', 3)),
    outOf: 'of 6 Student Body Organizations',
    hints: [
      {
        key: 'submit_reports:p1',
        text: 'Submit the ACR for “Tree Planting” to count it.',
        href: '/projects/p1',
      },
    ],
    leaderboardHref: '/leaderboard',
    ...overrides,
  });

  it('shows the rank, its board and what would move the organization up', () => {
    inRouter(<StandingCard model={ready()} />);
    expect(screen.getByText('of 6 Student Body Organizations')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Submit the ACR for “Tree Planting” to count it.' }),
    ).toHaveAttribute('href', '/projects/p1');
    expect(screen.getByRole('link', { name: /See the full leaderboard/ })).toHaveAttribute(
      'href',
      '/leaderboard',
    );
  });

  it('explains how to get ranked, and when nothing is waiting', () => {
    inRouter(<StandingCard model={ready({ standing: null, hints: [] })} />);
    expect(screen.getByText('Not ranked yet')).toBeInTheDocument();
    expect(screen.getByText(/Nothing is waiting/)).toBeInTheDocument();
  });

  it('renders nothing for the ISSC', () => {
    const { container } = inRouter(<StandingCard model={{ status: 'off' }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
