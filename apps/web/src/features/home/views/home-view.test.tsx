import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { OrganizationDetail } from '@orghive/shared';
import type { DocumentSearchModel } from '@/features/search/presenters/use-document-search';
import type { HomeData } from '../presenters/use-home-data';
import { HomeView } from './home-view';

// jsdom has no WebGL; the background's own logic is tested in use-animated-hero.test.ts.
vi.mock('../hooks/use-animated-hero', () => ({ useAnimatedHero: () => false }));

const ISSC: OrganizationDetail = {
  type: 'ISSC',
  slug: 'issc',
  acronym: 'ISSC',
  name: 'Institutional Supreme Student Council',
  description: 'The ISSC is the highest student governing body in the university.',
  logoUrl: null,
  logoSrcSet: null,
  parent: null,
  college: null,
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

const idleSearch: DocumentSearchModel = {
  query: '',
  setQuery: vi.fn(),
  results: { status: 'idle' },
};

function renderView(data: HomeData, search: DocumentSearchModel = idleSearch) {
  return render(
    <MemoryRouter>
      <HomeView {...data} search={search} account={{ label: 'Login', href: '/login' }} />
    </MemoryRouter>,
  );
}

describe('HomeView', () => {
  it('renders the header, hero, About Us, ISSC and contact sections', () => {
    renderView(props());

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('button', { name: 'Search' }).length).toBeGreaterThan(0);
    expect(within(nav).getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login');
    expect(within(nav).getByRole('link', { name: 'Colleges' })).toHaveAttribute(
      'href',
      '/colleges',
    );
    expect(within(nav).getByRole('link', { name: 'ISSC' })).toHaveAttribute('href', '/orgs/issc');

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
    expect(links.getByRole('link', { name: 'Updates' })).toHaveAttribute(
      'href',
      '/orgs/issc/updates',
    );
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

describe('SiteHeader menu and search', () => {
  it('opens the menu as a modal dialog with the site links, and closes it with Escape', () => {
    renderView(props());
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Menu' });
    const site = within(dialog).getByRole('navigation', { name: 'Site' });
    expect(
      within(site)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Home', 'Colleges', 'ISSC', 'Login']);
    expect(within(site).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
  });

  it('opens the search overlay with focus in the search field', () => {
    renderView(props());
    fireEvent.click(screen.getAllByRole('button', { name: 'Search' })[0]!);
    const dialog = screen.getByRole('dialog', { name: 'Search Paperworks' });
    expect(within(dialog).getByRole('searchbox', { name: 'Search Paperworks' })).toHaveFocus();
    expect(within(dialog).getByText(/Type at least two characters/)).toBeInTheDocument();
  });

  it('passes typing to the presenter and lists results as links', () => {
    const setQuery = vi.fn();
    renderView(props(), {
      query: 'bridge',
      setQuery,
      results: {
        status: 'ready',
        query: 'bridge',
        results: [
          {
            id: 'd1',
            title: 'Bridge design competition',
            organization: 'JPICE',
            organizationName: 'Junior Philippine Institute of Civil Engineers',
            typeName: 'Activity proposal',
            academicYear: '2026-2027',
            href: '/orgs/jpice/paperworks',
          },
        ],
      },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Search' })[0]!);
    const dialog = screen.getByRole('dialog', { name: 'Search Paperworks' });
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'bridges' } });
    expect(setQuery).toHaveBeenCalledWith('bridges');
    expect(within(dialog).getByText('1 result for “bridge”')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /Bridge design competition/ })).toHaveAttribute(
      'href',
      '/orgs/jpice/paperworks',
    );
  });
});
