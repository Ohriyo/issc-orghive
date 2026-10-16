import { lazy, Suspense } from 'react';
import { useAnimatedHero } from '../hooks/use-animated-hero';

// Code-split: the WebGL code is fetched only when it will actually run.
const HeroShader = lazy(() => import('./hero-shader'));

/**
 * The hero's background: a static green gradient that paints immediately, with the
 * animated shader layered on top when the device and user preferences allow it.
 */
export function HeroBackground() {
  const animated = useAnimatedHero();

  return (
    <div
      aria-hidden="true"
      className="bg-hero-static pointer-events-none absolute inset-0 mask-b-from-70%"
    >
      {animated ? (
        <Suspense fallback={null}>
          <HeroShader />
        </Suspense>
      ) : null}
    </div>
  );
}
