import { useEffect, useState } from 'react';
import { usePrefersReducedMotion } from '@/components/motion';
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

/** True once the animated shader should load: motion allowed, capable device, page idle. */
export function useAnimatedHero(): boolean {
  const reduced = usePrefersReducedMotion();
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (reduced || isLowEndDevice()) return;
    return whenIdle(() => setIdle(true));
  }, [reduced]);

  return idle && !reduced;
}
