import { useReducedMotion, type Transition, type Variants } from 'motion/react';

/** One easing curve for the whole app (also `ease-cinematic` in Tailwind). */
export const EASE_CINEMATIC = [0.22, 1, 0.36, 1] as const;

/** CLAUDE.md: keep durations between 300 and 500 ms. */
export const DURATION = { fast: 0.3, base: 0.4, slow: 0.5 } as const;

export const cinematic: Transition = { duration: DURATION.base, ease: EASE_CINEMATIC };

/**
 * Blur-to-sharp reveal: content comes into focus rather than sliding in.
 * Use with a parent that sets `staggerChildren` for a layered entrance.
 */
export const focusReveal: Variants = {
  hidden: { opacity: 0, y: 10, filter: 'blur(6px)' },
  shown: { opacity: 1, y: 0, filter: 'blur(0px)', transition: cinematic },
};

/** Same reveal without movement or blur, for prefers-reduced-motion. */
export const fadeReveal: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: 0 } },
};

/** True when the user asked the OS for reduced motion. */
export function usePrefersReducedMotion(): boolean {
  return useReducedMotion() ?? false;
}
