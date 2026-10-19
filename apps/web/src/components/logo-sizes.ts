/**
 * `sizes` for OrgLogo in each slot, so the browser picks the smallest srcset variant that
 * is still sharp. Approximate drawn widths of the logo inside its frame, phone first.
 */
export const LOGO_SIZES = {
  /** A honeycomb cell: 2 columns in 16rem on phones, 3 in 36rem on tablets, 4 from lg. */
  honeycomb: '(width >= 64rem) min(17vw, 12rem), (width >= 48rem) 9.5rem, min(26vw, 6rem)',
  /** A carousel slide. */
  carousel: '(width >= 64rem) min(20vw, 18rem), 55vw',
  /** The large single hexagon on organization, CSC and ISSC sections. */
  feature: '(width >= 64rem) 24rem, 60vw',
} as const;
