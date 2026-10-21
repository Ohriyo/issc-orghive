import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { OrganizationDetail } from '@orghive/shared';
import type { HomeLeaderboardModel } from '@/features/leaderboard/presenters/use-leaderboard-views';
import type { HomeData } from '../presenters/use-home-data';
import { HomeView } from './home-view';

const LEADERBOARD: HomeLeaderboardModel = {
  live: 'live',
  semester: '1st semester 2026–2027',
  boards: { SBO: { status: 'loading' }, CSC: { status: 'loading' } },
  shown: 'SBO',
  show: vi.fn(),
};

// jsdom has no WebGL; the background's own logic is tested in use-animated-hero.test.ts.
vi.mock('../hooks/use-animated-hero', () => ({ useAnimatedHero: () => false }));

const ISSC: OrganizationDetail = {
  id: '0195f3c0-0000-7000-8000-0000000000b1',
  type: 'ISSC',
  slug: 'issc',
  acronym: 'ISSC',
  name: 'Institutional Supreme Student Council',
  description: 'The ISSC is the highest student governing body in the university.',
  logoUrl: null,
  logoSrcSet: null,
  parent: null,
  college: null,
  mission: null,
  vision: null,
  contactEmail: null,
  links: [],
  officers: [],
  coverUrl: null,
  coverSrcSet: null,
};

function props(overrides: Partial<HomeData> = {}): HomeData {
  return {
    colleges: {
      data: [
        null,
        {
          id: 'cea',
          label: 'College of Engineering and Architecture',
          shortName: 'CEA',
          href: '/colleges/cea',
        },
        { id: 'cat', label: 'College of Agriculture and Technology', href: '/colleges/cat' },
      ],
      isLoading: false,
      isError: false,
      retry: vi.fn(),
    },
    issc: { data: ISSC, isLoading: false, isError: false, retry: vi.fn() },
    ...overrides,
  };
}

function renderView(data: HomeData) {
  return render(
    <MemoryRouter>
      <HomeView {...data} leaderboard={LEADERBOARD} handbook={{ status: 'none' }} />
    </MemoryRouter>,
  );
}

describe('HomeView', () => {
  it('renders the hero, About Us, ISSC and contact sections (the header is the shell’s)', () => {
    renderView(props());

    expect(
      screen.getByRole('heading', { level: 1, name: 'Organizing Unity, Archiving Transparency' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse Repository' })).toHaveAttribute(
      'href',
      '/browse',
    );
    expect(screen.getByRole('heading', { name: 'About Us' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /NwSSU-ISSC/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Contact us:' })).toBeInTheDocument();
  });

  it('shows the current Student Handbook between About Us and the ISSC', () => {
    render(
      <MemoryRouter>
        <HomeView
          {...props()}
          leaderboard={LEADERBOARD}
          handbook={{
            status: 'ready',
            edition: {
              academicYear: '2026-2027',
              yearLabel: '2026–2027',
              isCurrent: true,
              pageCount: 40,
              coverUrl: null,
              href: '/handbook',
            },
          }}
        />
      </MemoryRouter>,
    );
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf('Student Handbook')).toBe(headings.indexOf('About Us') + 1);
    expect(screen.getByText('2026–2027', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Read the Handbook' })).toHaveAttribute('href', '/handbook');
  });

  it('links each college hexagon to its college page', () => {
    renderView(props());
    const colleges = screen.getByRole('region', { name: 'Colleges' });
    expect(
      within(colleges).getByRole('link', { name: 'College of Engineering and Architecture' }),
    ).toHaveAttribute('href', '/colleges/cea');
    expect(
      within(colleges).getByRole('link', { name: 'College of Agriculture and Technology' }),
    ).toHaveAttribute('href', '/colleges/cat');
  });

  it('shows the ISSC description, logo and its three section links', () => {
    renderView(props());
    expect(screen.getByText(ISSC.description!)).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Institutional Supreme Student Council logo' }),
    ).toBeInTheDocument();

    const links = within(screen.getByRole('navigation', { name: 'ISSC sections' }));
    expect(links.getByRole('link', { name: 'Paperworks' })).toHaveAttribute(
      'href',
      '/orgs/issc/paperworks',
    );
    expect(links.getByRole('link', { name: 'CSC' })).toHaveAttribute('href', '/colleges');
    expect(links.getByRole('link', { name: 'Updates' })).toHaveAttribute('href', '/updates');
  });

  it('shows loading placeholders while data is on its way', () => {
    renderView(
      props({
        colleges: { data: [], isLoading: true, isError: false, retry: vi.fn() },
        issc: { data: undefined, isLoading: true, isError: false, retry: vi.fn() },
      }),
    );
    expect(screen.getByRole('region', { name: 'Colleges' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('heading', { name: 'Loading the ISSC profile' })).toBeInTheDocument();
  });

  it('explains a failed section and retries it', () => {
    const data = props({
      colleges: { data: [], isLoading: false, isError: true, retry: vi.fn() },
      issc: { data: undefined, isLoading: false, isError: true, retry: vi.fn() },
    });
    renderView(data);

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toHaveTextContent('The colleges could not be loaded');
    expect(alerts[1]).toHaveTextContent('The ISSC profile could not be loaded');

    fireEvent.click(within(alerts[0]!).getByRole('button', { name: 'Try again' }));
    expect(data.colleges.retry).toHaveBeenCalledTimes(1);
    fireEvent.click(within(alerts[1]!).getByRole('button', { name: 'Try again' }));
    expect(data.issc.retry).toHaveBeenCalledTimes(1);
  });

  it('says so when there are no colleges yet', () => {
    renderView(props({ colleges: { data: [], isLoading: false, isError: false, retry: vi.fn() } }));
    expect(screen.getByText(/No colleges have been added yet/)).toBeInTheDocument();
  });
});
