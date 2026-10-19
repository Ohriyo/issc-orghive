import { useMediaQuery } from './use-media-query';

/**
 * The app's breakpoints in rem, the same values as --breakpoint-* in index.css
 * (use-breakpoint.test.ts fails if they drift apart). For behavior CSS cannot express;
 * for styling, use the sm:/md:/lg:/xl:/2xl: prefixes instead.
 */
export const BREAKPOINTS = { sm: 40, md: 48, lg: 64, xl: 80, '2xl': 96 } as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

/** True from `breakpoint` up, exactly when Tailwind's `md:` (etc.) styles apply. */
export function useBreakpoint(breakpoint: Breakpoint): boolean {
  return useMediaQuery(`(width >= ${BREAKPOINTS[breakpoint]}rem)`);
}
