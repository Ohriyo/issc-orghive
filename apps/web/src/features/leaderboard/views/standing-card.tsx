import { ArrowRight, Check } from 'lucide-react';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { OriginLink } from '@/navigation/origin-link';
import { cn } from '@/lib/utils';
import type { MyStandingModel } from '../presenters/use-my-standing';
import { RankChange, RankNumeral } from './standing-marks';

/**
 * The dashboard's leaderboard card: where the organization stands on its board this
 * semester and what would move it up, each step linking to its project.
 */
export function StandingCard({ model }: { model: MyStandingModel }) {
  if (model.status === 'off') return null;
  return (
    <section
      aria-labelledby="standing-heading"
      className="rounded-3xl bg-white p-6 shadow-pool ring-1 ring-ink/10 md:p-8"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="standing-heading" className="text-h2 font-bold text-ink">
          Leaderboard
        </h2>
        {model.status === 'ready' ? (
          <p className="text-small text-ink-muted">{model.semester}</p>
        ) : null}
      </div>
      {model.status === 'loading' ? (
        <div aria-busy="true" className="mt-6 space-y-3">
          <p className="sr-only">Loading your standing</p>
          <Skeleton className="h-12 w-40" />
          <Skeleton className="h-5 w-64 max-w-full" />
        </div>
      ) : model.status === 'error' ? (
        <SectionError
          className="mt-6"
          message="Your standing could not be loaded. Check your connection and try again."
          onRetry={model.retry}
        />
      ) : (
        <div className="mt-6 grid gap-8 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-10">
          <div>
            {model.standing ? (
              <>
                <p className="flex items-end gap-3">
                  <RankNumeral
                    rank={model.standing.rank}
                    medal={model.standing.medal}
                    className="text-display"
                  />
                  <span className="pb-1.5 text-body text-ink">{model.outOf}</span>
                </p>
                <RankChange change={model.standing.change} className="mt-2" />
                <p className="mt-3 text-body font-medium text-ink">{model.standing.breakdown}</p>
                <p
                  className={cn(
                    'text-body font-semibold tabular-nums',
                    model.standing.profit.negative ? 'text-destructive' : 'text-ink',
                  )}
                >
                  {model.standing.profit.text} net profit
                </p>
                {model.standing.profit.underReview ? (
                  <p className="text-small text-caution">{model.standing.profit.underReview}</p>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-lead font-semibold text-ink">Not ranked yet</p>
                <p className="mt-1 text-body text-pretty text-ink-muted">
                  You join the {model.board} board once a project&apos;s event has passed and its
                  ACR and Financial Report are in.
                </p>
              </>
            )}
            <OriginLink
              to={model.leaderboardHref}
              className="tap-area mt-4 inline-flex items-center gap-1.5 text-body font-semibold text-ink underline-offset-4 hover:underline focus-visible:underline"
            >
              See the full leaderboard
              <ArrowRight aria-hidden="true" className="size-4" />
            </OriginLink>
          </div>

          <div>
            <h3 className="text-h3 font-semibold text-ink">What would move you up</h3>
            {model.hints.length > 0 ? (
              <ul className="mt-3 divide-y divide-border">
                {model.hints.map((hint) => (
                  <li key={hint.key}>
                    <OriginLink
                      to={hint.href}
                      className="flex min-h-11 items-center justify-between gap-3 py-3 text-body text-ink hover:underline focus-visible:underline"
                    >
                      <span className="text-pretty">{hint.text}</span>
                      <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
                    </OriginLink>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 flex items-start gap-2 text-body text-ink">
                <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-leaf" />
                Nothing is waiting: every project whose event has passed is counted. New projects
                add points once their reports are in.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
