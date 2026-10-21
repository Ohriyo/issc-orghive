import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  HEX_ASPECT,
  HEX_BAND,
  HEX_CLIP,
  HEX_RING,
  hexInset,
  type HexOrientation,
} from './hex-geometry';

export interface HexFrameProps {
  orientation?: HexOrientation;
  /** Dark forest outer band. Off when the hexagon sits on a forest surface already. */
  band?: boolean;
  /** The band's fill in place of forest, e.g. `bg-medal-gold-band` (leaderboard Top 3). */
  bandClassName?: string;
  /**
   * A soft light sweeping across the band now and then (leaderboard Top 3). Off with
   * prefers-reduced-motion.
   */
  shimmer?: boolean;
  /**
   * White inner border between the band and the fill. `interactive` shows it only on
   * hover or keyboard focus of the nearest `group` ancestor (e.g. a link around the hexagon).
   */
  ring?: boolean | 'interactive';
  /** Soft drop shadow under the hexagon. */
  shadow?: boolean;
  /** Band and ring thickness as a percentage of width; defaults match design/. */
  bandWidth?: number;
  ringWidth?: number;
  /** Width is set by the caller (e.g. `w-64`); height follows from the hexagon shape. */
  className?: string;
  /** Usually a logo. It is centered with breathing room from the edges. */
  children?: ReactNode;
  /** Extra classes for the content area, e.g. to change padding. */
  contentClassName?: string;
}

/** The prototype's signature hexagon: forest band, white ring and a sheened forest fill. */
export function HexFrame({
  orientation = 'flat',
  band = true,
  bandClassName,
  shimmer = false,
  ring = true,
  shadow = true,
  bandWidth = HEX_BAND,
  ringWidth = HEX_RING,
  className,
  children,
  contentClassName,
}: HexFrameProps) {
  const clip: CSSProperties = { clipPath: HEX_CLIP[orientation] };

  // Interactive ring: the fill covers the white ring at rest and shrinks to reveal it on
  // hover or focus. The ring layer's clip keeps the outline exact while the fill is scaled.
  const coverScale = 1 / (1 - (2 * ringWidth * (2 / Math.sqrt(3))) / 100);

  const fill = (
    <div
      className={cn(
        'bg-forest-sheen relative flex size-full items-center justify-center p-[16%]',
        ring === 'interactive' &&
          'ease-cinematic scale-(--hex-cover) transition-transform duration-300 group-hover:scale-100 group-focus-visible:scale-100 motion-reduce:transition-none',
        contentClassName,
      )}
      style={{ ...clip, '--hex-cover': coverScale.toFixed(4) } as CSSProperties}
    >
      {children}
    </div>
  );

  const withRing = ring ? (
    <div
      className="relative size-full bg-white"
      style={{ ...clip, ...hexInset(orientation, ringWidth) }}
    >
      {fill}
    </div>
  ) : (
    fill
  );

  return (
    <div
      className={cn('relative shrink-0', shadow && 'drop-shadow-hex', className)}
      style={{ aspectRatio: HEX_ASPECT[orientation] }}
    >
      {band ? (
        <div
          className={cn('relative size-full', bandClassName ?? 'bg-forest-band')}
          style={{ ...clip, ...hexInset(orientation, bandWidth) }}
        >
          {shimmer ? (
            // Under the ring and fill, so the light only crosses the band.
            <span
              aria-hidden="true"
              data-testid="hex-shimmer"
              className="bg-shimmer-streak animate-hex-shimmer absolute inset-0 motion-reduce:hidden"
            />
          ) : null}
          {withRing}
        </div>
      ) : (
        withRing
      )}
    </div>
  );
}
