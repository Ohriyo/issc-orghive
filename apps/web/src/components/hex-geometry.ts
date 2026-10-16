import type { CSSProperties } from 'react';

export type HexOrientation = 'flat' | 'pointy';

/** Flat: points left and right (the prototype's SBO and grid hexagons). Pointy: points up and down (CSC towers). */
export const HEX_CLIP: Record<HexOrientation, string> = {
  flat: 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)',
  pointy: 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)',
};

/** width / height of a regular hexagon in each orientation. */
export const HEX_ASPECT: Record<HexOrientation, number> = {
  flat: 2 / Math.sqrt(3),
  pointy: Math.sqrt(3) / 2,
};

/** Band and ring thickness as a percentage of the hexagon's width, measured from design/. */
export const HEX_BAND = 3.2;
export const HEX_RING = 1.5;

/**
 * Insetting every edge of a regular hexagon by the same distance keeps its shape,
 * but the inset along the pointed axis is 2/sqrt(3) times larger. Percent padding
 * is relative to the parent's width, so one value per layer gives an even band.
 */
export function hexInset(orientation: HexOrientation, percent: number): CSSProperties {
  const along = `${(percent * (2 / Math.sqrt(3))).toFixed(3)}%`;
  const across = `${percent}%`;
  return orientation === 'flat'
    ? { padding: `${across} ${along}` }
    : { padding: `${along} ${across}` };
}
