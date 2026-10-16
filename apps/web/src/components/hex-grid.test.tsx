import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
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
