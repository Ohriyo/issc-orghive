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
        'bg-forest-sheen flex size-full items-center justify-center p-[16%]',
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
    <div className="size-full bg-white" style={{ ...clip, ...hexInset(orientation, ringWidth) }}>
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
          className="bg-forest-band size-full"
          style={{ ...clip, ...hexInset(orientation, bandWidth) }}
        >
          {withRing}
        </div>
      ) : (
        withRing
      )}
    </div>
  );
}
