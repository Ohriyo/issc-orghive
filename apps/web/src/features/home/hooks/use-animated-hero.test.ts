import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAnimatedHero } from './use-animated-hero';

const state = vi.hoisted(() => ({ reduced: false, lowEnd: false, wide: true }));

vi.mock('@/components/motion', () => ({ usePrefersReducedMotion: () => state.reduced }));
vi.mock('@/lib/device', () => ({ isLowEndDevice: () => state.lowEnd }));
vi.mock('@/hooks/use-breakpoint', () => ({ useBreakpoint: () => state.wide }));

afterEach(() => {
  state.reduced = false;
  state.lowEnd = false;
  state.wide = true;
});

describe('useAnimatedHero', () => {
  it('turns on once the browser is idle on a capable device', async () => {
    const { result } = renderHook(() => useAnimatedHero());
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('stays off under prefers-reduced-motion', async () => {
    state.reduced = true;
    const { result } = renderHook(() => useAnimatedHero());
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(result.current).toBe(false);
  });

  it('stays off on a low-end device', async () => {
    state.lowEnd = true;
    const { result } = renderHook(() => useAnimatedHero());
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(result.current).toBe(false);
  });

  it('stays off below md (768px): phones keep the static gradient', async () => {
    state.wide = false;
    const { result } = renderHook(() => useAnimatedHero());
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(result.current).toBe(false);
  });

  it('turns off again when the window narrows below md', async () => {
    const { result, rerender } = renderHook(() => useAnimatedHero());
    await waitFor(() => expect(result.current).toBe(true));
    state.wide = false;
    rerender();
    expect(result.current).toBe(false);
  });
});
