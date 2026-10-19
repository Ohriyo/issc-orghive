import { useEffect, useState } from 'react';
import { usePrefersReducedMotion } from '@/components/motion';
import { useBreakpoint } from '@/hooks/use-breakpoint';
import { isLowEndDevice } from '@/lib/device';

/** Defers non-critical work until the browser is idle (Safari lacks requestIdleCallback). */
function whenIdle(callback: () => void): () => void {
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(callback, { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(callback, 300);
  return () => clearTimeout(id);
}

/**
 * True once the animated shader should load: motion allowed, a capable device, a screen at
 * least md (768px) wide, and the page idle. Phones keep the static gradient: the shader
 * costs battery and data for a background they barely see. Narrowing the window below md
 * turns it off again.
 */
export function useAnimatedHero(): boolean {
  const reduced = usePrefersReducedMotion();
  const wide = useBreakpoint('md');
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (reduced || !wide || isLowEndDevice()) return;
    return whenIdle(() => setIdle(true));
  }, [reduced, wide]);

  return idle && !reduced && wide;
}
