import { readFileSync } from 'node:fs';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BREAKPOINTS, useBreakpoint } from './use-breakpoint';

describe('BREAKPOINTS', () => {
  it('matches the --breakpoint-* tokens in index.css', () => {
    // Tests run from apps/web (jsdom gives import.meta.url an http: scheme).
    const css = readFileSync('src/index.css', 'utf8');
    const tokens: Record<string, number> = {};
    for (const [, name, rem] of css.matchAll(/--breakpoint-([a-z0-9]+):\s*([\d.]+)rem/g)) {
      tokens[name!] = Number(rem);
    }
    expect(tokens).toEqual(BREAKPOINTS);
  });
});

describe('useBreakpoint', () => {
  const listeners = new Set<() => void>();
  let width = 360;

  function mockViewport() {
    vi.stubGlobal('matchMedia', (query: string) => {
      const rem = Number(/width >= ([\d.]+)rem/.exec(query)?.[1]);
      return {
        get matches() {
          return width >= rem * 16;
        },
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      };
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    listeners.clear();
  });

  it('is true from the breakpoint up and follows resizes', () => {
    width = 767;
    mockViewport();
    const { result } = renderHook(() => useBreakpoint('md'));
    expect(result.current).toBe(false);

    width = 768;
    act(() => listeners.forEach((fn) => fn()));
    expect(result.current).toBe(true);
  });
});
