import { useMemo } from 'react';
import { ArrowDown, ArrowUp, Minus, Sparkle } from 'lucide-react';
import { motion } from 'motion/react';
import { HEX_CLIP } from '@/components/hex-geometry';
import { EASE_CINEMATIC, usePrefersReducedMotion } from '@/components/motion';
import { cn } from '@/lib/utils';
import type { Medal, RankChangeView } from '../presenters/leaderboard-model';
import type { LiveState } from '../presenters/use-leaderboard';
import { confettiPieces, MEDAL_STYLES } from './standing-styles';

/**
 * A rank as a large numeral. A medal rank takes its metal's ink and a surface-coloured
 * halo, so it stays legible where it overlaps a hexagon's band.
 */
export function RankNumeral({
  rank,
  medal,
  className,
}: {
  rank: number;
  medal: Medal | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'font-bold leading-none tabular-nums',
        medal
          ? [
              MEDAL_STYLES[medal].ink,
              '[paint-order:stroke_fill] [-webkit-text-stroke:0.18em_var(--color-surface)]',
            ]
          : 'text-ink',
        className,
      )}
    >
      <span className="sr-only">Rank </span>
      {rank}
    </span>
  );
}

const CHANGE_ICON = { up: ArrowUp, down: ArrowDown, same: Minus, new: Sparkle } as const;
const CHANGE_COLOR = {
  up: 'text-ink',
  down: 'text-destructive',
  same: 'text-ink-muted',
  new: 'text-ink-muted',
} as const;

/** ↑2, ↓1, – or "New", with the full sentence for screen readers. */
export function RankChange({ change, className }: { change: RankChangeView; className?: string }) {
  const Icon = CHANGE_ICON[change.direction];
  return (
    <span
      title={change.label}
      className={cn(
        'inline-flex items-center gap-0.5 text-small font-semibold tabular-nums',
        CHANGE_COLOR[change.direction],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-4" strokeWidth={2.5} />
      <span aria-hidden="true">
        {change.direction === 'new' ? 'New' : change.places > 0 ? change.places : null}
      </span>
      <span className="sr-only">{change.label}</span>
    </span>
  );
}

const LIVE_COPY: Record<LiveState, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  polling: 'Updates every minute',
};

const LIVE_DOT: Record<LiveState, string> = {
  connecting: 'bg-medal-gold',
  live: 'bg-leaf',
  reconnecting: 'bg-medal-gold',
  polling: 'bg-ink-muted',
};

/** Whether the boards follow changes as they happen (the SSE stream) or every minute. */
export function LiveIndicator({ live, className }: { live: LiveState; className?: string }) {
  return (
    <p
      role="status"
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-border bg-white px-3.5 py-1.5 text-small font-medium text-ink',
        className,
      )}
    >
      <span aria-hidden="true" className={cn('size-2.5 rounded-full', LIVE_DOT[live])} />
      {LIVE_COPY[live]}
    </p>
  );
}

/**
 * The laurel's left branch: a stem curving from the top centre down to the left, with
 * leaves set alternately along it, each turned along the stem. The right branch mirrors it.
 */
const STEM = { from: [58, 7], control: [16, 4], to: [7, 44] } as const;

function stemAt(t: number) {
  const [x0, y0] = STEM.from;
  const [x1, y1] = STEM.control;
  const [x2, y2] = STEM.to;
  const u = 1 - t;
  return {
    x: u * u * x0 + 2 * u * t * x1 + t * t * x2,
    y: u * u * y0 + 2 * u * t * y1 + t * t * y2,
    // The stem's direction there, in degrees.
    angle:
      (Math.atan2(2 * u * (y1 - y0) + 2 * t * (y2 - y1), 2 * u * (x1 - x0) + 2 * t * (x2 - x1)) *
        180) /
      Math.PI,
  };
}

const LAUREL_LEAVES = [0.16, 0.3, 0.44, 0.58, 0.72, 0.86].map((t, i) => {
  const { x, y, angle } = stemAt(t);
  const side = i % 2 === 0 ? 1 : -1;
  const tilt = angle + side * 38;
  const rad = (tilt * Math.PI) / 180;
  // Each leaf grows out from the stem, its base on it.
  return { x: x + Math.cos(rad) * 5, y: y + Math.sin(rad) * 5, rotate: tilt };
});

/** A small laurel crowning the #1's hexagon. Decorative: the rank says it already. */
export function LaurelMark({ className }: { className?: string }) {
  const [x0, y0] = STEM.from;
  const [x1, y1] = STEM.control;
  const [x2, y2] = STEM.to;
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 120 48"
      className={cn('text-medal-gold-ink', className)}
      fill="currentColor"
    >
      {[1, -1].map((side) => (
        <g key={side} transform={side === -1 ? 'translate(120 0) scale(-1 1)' : undefined}>
          <path
            d={`M${x0} ${y0} Q${x1} ${y1} ${x2} ${y2}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          {LAUREL_LEAVES.map((leaf) => (
            <ellipse
              key={`${leaf.x}`}
              cx={leaf.x}
              cy={leaf.y}
              rx="6.2"
              ry="2.6"
              transform={`rotate(${leaf.rotate} ${leaf.x} ${leaf.y})`}
            />
          ))}
        </g>
      ))}
      {/* A small hexagon where the branches meet. */}
      <polygon points="60,1 65,4 65,10 60,13 55,10 55,4" />
    </svg>
  );
}

/**
 * A short burst of small hexagons when a Top 3 changes live. Plays once per `burst`;
 * nothing with prefers-reduced-motion. Purely decorative.
 */
export function ConfettiBurst({ burst, className }: { burst: number; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const pieces = useMemo(() => confettiPieces(burst), [burst]);
  if (burst === 0 || reduced) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="confetti"
      className={cn('pointer-events-none absolute z-20 size-0', className)}
    >
      {pieces.map((piece) => (
        <motion.span
          key={`${burst}-${piece.id}`}
          className={cn('absolute', piece.size, piece.color)}
          style={{ clipPath: HEX_CLIP.flat }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.4 }}
          animate={{
            x: piece.x,
            y: [0, piece.y, piece.y + piece.fall],
            opacity: [1, 1, 0],
            rotate: piece.rotate,
            scale: 1,
          }}
          transition={{ duration: 0.5, ease: EASE_CINEMATIC, times: [0, 0.6, 1] }}
        />
      ))}
    </div>
  );
}
