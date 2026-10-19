import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { DURATION, EASE_CINEMATIC, usePrefersReducedMotion } from './motion';

/** Paths traced from design/college-cea.png at its native 1366 x 300 scale. */
const BANDS = [
  {
    name: 'olive',
    className: 'fill-olive',
    d: 'M495 37C640 15 800 35 950 90C1080 135 1200 135 1366 85V112C1250 165 1110 182 985 165C880 150 800 132 740 115C650 88 570 55 495 37Z',
  },
  {
    name: 'ink',
    className: 'fill-ink',
    d: 'M0 100C150 60 280 40 420 45C600 50 760 120 980 180C1150 225 1280 215 1366 180V198C1270 250 1120 275 950 255C760 232 600 170 420 160C260 152 120 190 0 265Z',
  },
  {
    name: 'leaf',
    className: 'fill-leaf',
    d: 'M0 292C140 235 330 200 550 195C360 225 200 262 0 300Z',
  },
] as const;

export interface WaveDividerProps {
  /** Mirror horizontally, so the olive crest sits top-left. */
  flip?: boolean;
  /**
   * Fill whatever box the caller sets (e.g. `h-10 w-full`) instead of keeping the
   * prototype's proportions: a thin wave between dashboard sections.
   */
  stretch?: boolean;
  className?: string;
}

/**
 * The prototype's sweeping section divider: an ink band with an olive crest above
 * and a leaf swoosh below. The bands settle into place one after another the first
 * time the divider scrolls into view.
 */
export function WaveDivider({ flip = false, stretch = false, className }: WaveDividerProps) {
  const reduced = usePrefersReducedMotion();

  return (
    <svg
      viewBox="0 0 1366 300"
      preserveAspectRatio={stretch ? 'none' : undefined}
      className={cn('block w-full', !stretch && 'h-auto', flip && '-scale-x-100', className)}
      aria-hidden="true"
      focusable="false"
    >
      {BANDS.map((band, i) => (
        <motion.path
          key={band.name}
          d={band.d}
          className={band.className}
          initial={reduced ? false : { opacity: 0, x: i % 2 === 0 ? 48 : -48 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: DURATION.slow, ease: EASE_CINEMATIC, delay: i * 0.08 }}
        />
      ))}
    </svg>
  );
}
