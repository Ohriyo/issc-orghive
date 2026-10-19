import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HexGrid, type HexGridCell } from './hex-grid';

const cells: HexGridCell[] = [
  null,
  {
    id: 'cea',
    label: 'College of Engineering and Architecture',
    logoSrc: '/cea.png',
    href: '/colleges/cea',
  },
  { id: 'con', label: 'College of Nursing', logoSrc: '/con.png' },
  null,
];

function renderGrid(props: Partial<Parameters<typeof HexGrid>[0]> = {}) {
  return render(
    <MemoryRouter>
      <HexGrid label="Colleges" cells={cells} {...props} />
    </MemoryRouter>,
  );
}

describe('HexGrid', () => {
  it('lists only the real cells, not the decorative fillers', () => {
    renderGrid({ hideFillersOnMobile: false });
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('list').querySelectorAll('li[aria-hidden="true"]')).toHaveLength(2);
  });

  it('links cells that have an href, named after the organization', () => {
    renderGrid();
    expect(
      screen.getByRole('link', { name: 'College of Engineering and Architecture' }),
    ).toHaveAttribute('href', '/colleges/cea');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('keeps cells in data order for keyboard and screen readers', () => {
    renderGrid({
      cells: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: `Org ${id}`, href: `/${id}` })),
    });
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('aria-label'))).toEqual([
      'Org a',
      'Org b',
      'Org c',
      'Org d',
      'Org e',
    ]);
  });

  it('shows the error state instead of the grid', () => {
    renderGrid({ error: <p>Couldn't load the colleges.</p> });
    expect(screen.getByText("Couldn't load the colleges.")).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('gives logos alt text', () => {
    renderGrid();
    expect(screen.getByAltText('College of Nursing logo')).toBeInTheDocument();
  });

  it('shows placeholders while loading', () => {
    renderGrid({ isLoading: true });
    expect(screen.getByRole('region', { name: 'Colleges' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText('Loading')).toBeInTheDocument();
  });

  it('drops decorative fillers on phones so the reflowed grid has no holes', () => {
    renderGrid();
    expect(screen.getByRole('list').querySelectorAll('li')).toHaveLength(2);
  });

  it('shows the empty state when there are no cells', () => {
    renderGrid({ cells: [], emptyState: <p>No colleges yet.</p> });
    expect(screen.getByText('No colleges yet.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});

describe('HexGrid responsive columns', () => {
  /** Emulates a viewport width for useBreakpoint's (width >= Nrem) queries. */
  function atWidth(px: number) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: px >= Number(/([\d.]+)rem/.exec(query)?.[1]) * 16,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  }
  afterEach(() => vi.unstubAllGlobals());

  const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, label: `Org ${id}` }));
  /** Distinct column offsets (`left`) used by the placed cells. */
  function columnCount() {
    const lefts = [...screen.getByRole('list').querySelectorAll('li')].map((li) => li.style.left);
    return new Set(lefts).size;
  }

  it('uses 2 columns on phones, 3 on tablets and the full honeycomb from lg', () => {
    atWidth(360);
    const { unmount } = renderGrid({ cells: six });
    expect(columnCount()).toBe(2);
    unmount();

    atWidth(768);
    const tablet = renderGrid({ cells: six });
    expect(columnCount()).toBe(3);
    tablet.unmount();

    atWidth(1366);
    renderGrid({ cells: six });
    expect(columnCount()).toBe(4);
  });

  it('drops decorative fillers below lg, where they would leave holes', () => {
    atWidth(768);
    const { unmount } = renderGrid();
    expect(screen.getByRole('list').querySelectorAll('li[aria-hidden="true"]')).toHaveLength(0);
    unmount();

    atWidth(1366);
    renderGrid();
    expect(screen.getByRole('list').querySelectorAll('li[aria-hidden="true"]')).toHaveLength(2);
  });
});
