import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { AccountMenuModel } from '@/features/auth/presenters/use-account-menu';
import type { DocumentSearchModel } from '@/features/search/presenters/use-document-search';
import { AppHeader, type AppHeaderProps } from './app-header';

const idleSearch: DocumentSearchModel = {
  query: '',
  setQuery: vi.fn(),
  results: { status: 'idle' },
};

const signedIn: AccountMenuModel = {
  status: 'authenticated',
  name: 'Juan Dela Cruz',
  email: 'juan@nwssu.test',
  initials: 'JD',
  roles: ['JPICE, Officer (President)'],
  signOut: vi.fn(),
  isSigningOut: false,
};

function renderView(
  search: DocumentSearchModel = idleSearch,
  overrides: Partial<AppHeaderProps> = {},
) {
  return render(
    <MemoryRouter>
      <AppHeader
        search={search}
        account={{ status: 'anonymous' }}
        section="home"
        overlay={false}
        solid
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe('AppHeader', () => {
  it('links the logo home and shows Colleges, ISSC, Search and Login when signed out', () => {
    renderView();
    expect(screen.getByRole('link', { name: 'Orghive home' })).toHaveAttribute('href', '/');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Colleges' })).toHaveAttribute(
      'href',
      '/colleges',
    );
    expect(within(nav).getByRole('link', { name: 'ISSC' })).toHaveAttribute('href', '/orgs/issc');
    expect(within(nav).queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Search' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login');
  });

  it('adds Dashboard and the user menu when signed in, and highlights the section', () => {
    renderView(idleSearch, { account: signedIn, section: 'dashboard' });
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(nav).getByRole('link', { name: 'Colleges' })).not.toHaveAttribute('aria-current');
    expect(
      screen.getByRole('button', { name: 'Account menu, Juan Dela Cruz' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Login' })).not.toBeInTheDocument();
  });
  it('opens the menu as a modal dialog with the site links, and closes it with Escape', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Menu' });
    const site = within(dialog).getByRole('navigation', { name: 'Site' });
    expect(
      within(site)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Home', 'Colleges', 'ISSC']);
    expect(within(site).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(dialog).getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
  });

  it('opens the search overlay with focus in the search field', () => {
    renderView();
    fireEvent.click(screen.getAllByRole('button', { name: 'Search' })[0]!);
    const dialog = screen.getByRole('dialog', { name: 'Search Paperworks' });
    expect(within(dialog).getByRole('searchbox', { name: 'Search Paperworks' })).toHaveFocus();
    expect(within(dialog).getByText(/Type at least two characters/)).toBeInTheDocument();
  });

  it('passes typing to the presenter and lists results as links', () => {
    const setQuery = vi.fn();
    renderView({
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
    } satisfies DocumentSearchModel);
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

  it('lists the account, its organizations and sign out in the phone menu', () => {
    renderView(idleSearch, { account: signedIn });
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const account = screen.getByRole('region', { name: 'Your account' });
    expect(within(account).getByText('JPICE, Officer (President)')).toBeInTheDocument();
    fireEvent.click(within(account).getByRole('button', { name: 'Sign out' }));
    expect(signedIn.status === 'authenticated' && signedIn.signOut).toHaveBeenCalled();
  });
});
