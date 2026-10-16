import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PillButton } from './pill-button';
import { WaveDivider } from './wave-divider';

describe('PillButton', () => {
  it('is a non-submitting button by default', () => {
    render(<PillButton>Paperworks</PillButton>);
    expect(screen.getByRole('button', { name: 'Paperworks' })).toHaveAttribute('type', 'button');
  });

  it('keeps white text on the forest variant', () => {
    render(<PillButton>Paperworks</PillButton>);
    expect(screen.getByRole('button')).toHaveClass('text-white', 'text-body');
  });

  it('can render as a link', () => {
    render(
      <PillButton asChild variant="light">
        <a href="/colleges/cea">Proceed</a>
      </PillButton>,
    );
    const link = screen.getByRole('link', { name: 'Proceed' });
    expect(link).toHaveClass('text-ink');
    expect(link).not.toHaveAttribute('type');
  });
});

describe('WaveDivider', () => {
  it('is decorative', () => {
    const { container } = render(<WaveDivider />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
