import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('keeps a text color next to a custom type-scale size', () => {
    expect(cn('text-white', 'text-body')).toBe('text-white text-body');
    expect(cn('text-ink text-h3')).toBe('text-ink text-h3');
  });

  it('still lets a later size override an earlier one', () => {
    expect(cn('text-body', 'text-lead')).toBe('text-lead');
  });
});
