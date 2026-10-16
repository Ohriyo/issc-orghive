/**
 * `sizes` for OrgLogo in each slot, so the browser picks the smallest srcset variant that
 * is still sharp. Approximate drawn widths of the logo inside its frame, phone first.
 */
export const LOGO_SIZES = {
  /** A honeycomb cell: 2 columns on phones, 4 in a grid of at most 58rem from md up. */
  honeycomb: '(width >= 48rem) min(12vw, 10rem), 32vw',
  /** A carousel slide. */
  carousel: '(width >= 64rem) min(20vw, 18rem), 55vw',
  /** The large single hexagon on organization, CSC and ISSC sections. */
  feature: '(width >= 64rem) 24rem, 60vw',
} as const;
