import { motion } from 'motion/react';
import { HexFrame } from '@/components/hex-frame';
import { cinematic, usePrefersReducedMotion } from '@/components/motion';
import { OrgLogo } from '@/components/org-logo';
import { OriginLink } from '@/navigation/origin-link';
import { cn } from '@/lib/utils';
import type { StandingView } from '../presenters/leaderboard-model';
import { RankChange, RankNumeral } from './standing-marks';

/**
 * Rows 4 and below: rank and its change, the organization, its breakdown and net profit.
 * Rows glide to their new place when the order changes. The whole row links to the
 * organization's page.
 */
export function StandingsList({
  rows,
  label,
  start,
}: {
  rows: StandingView[];
  label: string;
  /** The first row's position in the list, for `<ol start>`. */
  start: number;
}) {
  const reduced = usePrefersReducedMotion();
  if (rows.length === 0) return null;
  return (
    <ol
      aria-label={label}
      start={start}
      className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-white"
    >
      {rows.map((row) => (
        <motion.li
          key={row.key}
          layout={reduced ? false : 'position'}
          transition={cinematic}
          className={cn(
            'relative grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 bg-white px-4 py-4',
            'md:grid-cols-[4rem_minmax(0,1fr)_minmax(0,14rem)_9rem] md:gap-x-5 md:px-6',
            'transition-colors duration-300 hover:bg-accent has-[a:focus-visible]:bg-accent',
          )}
        >
          <div className="row-span-3 flex flex-col items-center gap-1 self-start md:row-span-1 md:self-center">
            <RankNumeral rank={row.rank} medal={row.medal} className="text-h2" />
            <RankChange change={row.change} />
          </div>

          <div className="flex min-w-0 items-center gap-3">
            <HexFrame band={false} ring={false} shadow={false} className="w-11">
              <OrgLogo
                name={row.name}
                alt=""
                src={row.logoSrc}
                srcSet={row.logoSrcSet}
                sizes="2rem"
                fallbackText={row.acronym}
                className="size-full"
              />
            </HexFrame>
            <div className="min-w-0">
              <OriginLink
                to={row.href}
                // The link covers the row: tap anywhere on it.
                className="block truncate text-body-lg font-bold text-ink outline-none before:absolute before:inset-0 hover:underline focus-visible:underline"
              >
                {row.acronym}
              </OriginLink>
              <p className="truncate text-small text-ink-muted">
                {row.college ? `${row.name} (${row.college})` : row.name}
              </p>
            </div>
          </div>

          <p className="text-small font-medium text-ink md:text-body">{row.breakdown}</p>

          <p className="md:text-right">
            <span
              className={cn(
                'text-body font-semibold tabular-nums',
                row.profit.negative ? 'text-destructive' : 'text-ink',
              )}
            >
              {row.profit.text}
              <span className="sr-only"> net profit</span>
            </span>
            {row.profit.underReview ? (
              <span className="block text-caption text-caution">{row.profit.underReview}</span>
            ) : null}
          </p>
        </motion.li>
      ))}
    </ol>
  );
}
