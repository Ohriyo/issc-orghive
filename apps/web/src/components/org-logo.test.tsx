import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { initialsOf } from '@/lib/initials';
import { OrgLogo } from './org-logo';

describe('initialsOf', () => {
  it('skips minor words', () => {
    expect(initialsOf('College of Engineering and Architecture')).toBe('CEA');
    expect(initialsOf('Institutional Supreme Student Council')).toBe('ISSC');
  });
});

describe('OrgLogo', () => {
  it('renders the logo with alt text', () => {
    render(<OrgLogo name="College of Nursing" src="/con.png" />);
    expect(screen.getByRole('img', { name: 'College of Nursing logo' })).toHaveAttribute(
      'src',
      '/con.png',
    );
  });

  it('falls back to initials when there is no logo', () => {
    render(<OrgLogo name="College of Nursing" />);
    expect(screen.getByRole('img', { name: 'College of Nursing logo' })).toHaveTextContent('CN');
  });

  it('falls back to the short name when the image fails to load', () => {
    render(<OrgLogo name="College of Nursing" src="/broken.png" fallbackText="CON" />);
    fireEvent.error(screen.getByRole('img'));
    const fallback = screen.getByRole('img', { name: 'College of Nursing logo' });
    expect(fallback.tagName).toBe('SPAN');
    expect(fallback).toHaveTextContent('CON');
  });

  it('stays out of the accessibility tree when marked decorative', () => {
    render(<OrgLogo name="College of Nursing" alt="" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
