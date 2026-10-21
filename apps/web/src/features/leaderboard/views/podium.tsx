import { motion } from 'motion/react';
import { HexFrame } from '@/components/hex-frame';
import { cinematic, usePrefersReducedMotion } from '@/components/motion';
import { OrgLogo } from '@/components/org-logo';
import { OriginLink } from '@/navigation/origin-link';
import { cn } from '@/lib/utils';
import type { StandingView } from '../presenters/leaderboard-model';
import { ConfettiBurst, LaurelMark, RankNumeral } from './standing-marks';
import { MEDAL_STYLES } from './standing-styles';

/** The hexagon's drawn width per place, for the logo's `sizes`. */
const LOGO_SIZES = {
  first: '(width >= 64rem) 9rem, (width >= 48rem) 8rem, 7rem',
  other: '(width >= 64rem) 6.5rem, (width >= 48rem) 6rem, 6rem',
};

/**
 * Where each place sits from md up: the #1 in the middle and raised, #2 to its left and #3
 * to its right a step lower, like three cells of one honeycomb. Below md the podium is a
 * row you swipe, in rank order (#1 first).
 */
const PLACE = [
  { cell: 'md:order-2', hex: 'w-44 md:w-[78%] md:max-w-56' },
  { cell: 'md:order-1 md:mt-20', hex: 'w-36 md:w-[64%] md:max-w-44' },
  { cell: 'md:order-3 md:mt-20', hex: 'w-36 md:w-[64%] md:max-w-44' },
] as const;

export interface PodiumProps {
  entries: StandingView[];
  /** "Top 3 Student Body Organizations", for the list's accessible name. */
  label: string;
  /** A new value plays the celebration (a live change to the Top 3). */
  bursts: number;
  className?: string;
}

/** The Top 3 as hexagons with medal bands; the cards swap places when the order changes. */
export function Podium({ entries, label, bursts, className }: PodiumProps) {
  const reduced = usePrefersReducedMotion();
  return (
    <div className={cn('relative', className)}>
      <ConfettiBurst burst={bursts} className="top-[18%] left-1/2" />
      <ol
        aria-label={label}
        className={cn(
          // Phones: a swipeable row, bleeding to the screen edges (the 16/24px gutter) so the
          // next card peeks in.
          '-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pt-8 pb-4 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6',
          'md:mx-0 md:grid md:grid-cols-3 md:items-start md:gap-2 md:overflow-visible md:px-0 md:pb-0',
        )}
      >
        {entries.map((entry, index) => (
          <motion.li
            key={entry.key}
            // Reduced motion: the cards change places at once.
            layout={reduced ? false : 'position'}
            transition={cinematic}
            className={cn(
              // relative: absolutely placed children (sr-only text) stay inside the scroll
              // row; otherwise they escape its clipping and widen the page on phones.
              'relative flex w-[78%] max-w-72 shrink-0 snap-center flex-col items-center text-center md:w-auto md:max-w-none',
              PLACE[index]?.cell,
            )}
          >
            <PodiumCell entry={entry} first={index === 0} />
          </motion.li>
        ))}
      </ol>
    </div>
  );
}

function PodiumCell({ entry, first }: { entry: StandingView; first: boolean }) {
  const medal = entry.medal ?? 'bronze';
  const place = PLACE[first ? 0 : 1];
  return (
    <>
      <OriginLink
        to={entry.href}
        className="group relative flex w-full flex-col items-center rounded-3xl outline-offset-4"
      >
        <span className={cn('relative flex w-full justify-center', first ? 'pt-9' : 'pt-6')}>
          {first ? (
            <LaurelMark className="absolute top-0 left-1/2 w-32 -translate-x-1/2 md:w-36" />
          ) : null}
          <HexFrame
            bandClassName={MEDAL_STYLES[medal].band}
            shimmer
            shadow={!first}
            className={cn(place.hex, first && 'drop-shadow-gold-glow')}
          >
            <OrgLogo
              name={entry.name}
              alt=""
              src={entry.logoSrc}
              srcSet={entry.logoSrcSet}
              sizes={first ? LOGO_SIZES.first : LOGO_SIZES.other}
              fallbackText={entry.acronym}
              className="size-full"
            />
          </HexFrame>
          <RankNumeral
            rank={entry.rank}
            medal={entry.medal}
            className={cn('absolute bottom-0 left-[6%]', first ? 'text-display' : 'text-h1')}
          />
        </span>
        <span className="mt-3 text-h3 font-bold text-ink group-hover:underline group-focus-visible:underline">
          {entry.acronym}
        </span>
      </OriginLink>
      <p className="mt-0.5 line-clamp-2 max-w-60 text-small text-ink-muted">{entry.name}</p>
      {entry.college ? (
        <p className="text-small font-semibold text-ink-muted">{entry.college}</p>
      ) : null}
      <p className="mt-2 text-small font-medium text-ink">{entry.breakdown}</p>
      <p
        className={cn(
          'mt-0.5 text-body font-semibold tabular-nums',
          entry.profit.negative ? 'text-destructive' : 'text-ink',
        )}
      >
        {entry.profit.text}
        <span className="sr-only"> net profit</span>
      </p>
      {entry.profit.underReview ? (
        <p className="text-caption text-caution">{entry.profit.underReview}</p>
      ) : null}
    </>
  );
}
