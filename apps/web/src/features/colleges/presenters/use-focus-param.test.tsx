import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { SpotlightItem } from '@/components/spotlight-carousel/spotlight-carousel';
import { useFocusParam } from './use-focus-param';

const items: SpotlightItem[] = ['cat', 'ccis', 'cea'].map((id) => ({
  id,
  name: id.toUpperCase(),
  href: `/colleges/${id}`,
}));

function renderAt(url: string, list = items) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  );
  return renderHook(
    () => ({ focus: useFocusParam(list), location: useLocation(), action: useNavigationType() }),
    { wrapper },
  );
}

describe('useFocusParam', () => {
  it('starts on the item named by ?focus=', () => {
    expect(renderAt('/colleges?focus=cea').result.current.focus.initialIndex).toBe(2);
  });

  it('starts on the first item when ?focus= is missing or unknown', () => {
    expect(renderAt('/colleges').result.current.focus.initialIndex).toBe(0);
    expect(renderAt('/colleges?focus=nope').result.current.focus.initialIndex).toBe(0);
  });

  it('writes the centered item to ?focus= without adding a history entry', () => {
    const { result } = renderAt('/colleges?focus=cat&q=x');
    act(() => result.current.focus.onSelectedChange(items[1]!));

    expect(result.current.location.search).toBe('?focus=ccis&q=x');
    expect(result.current.action).toBe('REPLACE');
  });

  it('keeps initialIndex fixed to the arrival URL while the carousel moves', () => {
    const { result } = renderAt('/colleges?focus=cea');
    act(() => result.current.focus.onSelectedChange(items[0]!));
    expect(result.current.location.search).toBe('?focus=cat');
    expect(result.current.focus.initialIndex).toBe(2);
  });

  it('keeps onSelectedChange stable across renders', () => {
    const { result, rerender } = renderAt('/colleges');
    const first = result.current.focus.onSelectedChange;
    rerender();
    expect(result.current.focus.onSelectedChange).toBe(first);
  });
});
