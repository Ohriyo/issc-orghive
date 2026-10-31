import { LEADERBOARD_TYPES, type LeaderboardType } from '@orghive/shared';
import { Container } from '@/components/container';
import { PillButton } from '@/components/pill-button';
import { SampleDataChip } from '@/components/sample-data-chip';
import { SectionError } from '@/components/section-error';
import { OriginLink } from '@/navigation/origin-link';
import { cn } from '@/lib/utils';
import { BOARD_LABELS } from '@/features/leaderboard/presenters/leaderboard-model';
import type {
  BoardState,
  HomeLeaderboardModel,
} from '@/features/leaderboard/presenters/use-leaderboard-views';
import { BoardEmpty, BoardSkeleton } from '@/features/leaderboard/views/board-states';
import { Podium } from '@/features/leaderboard/views/podium';
import { LiveIndicator } from '@/features/leaderboard/views/standing-marks';

/**
 * "Top Organizations this Semester", under the hero: the Top 3 SBOs and the Top 3 CSCs, side
 * by side from lg. Below lg a toggle picks one podium, and on phones each podium is a row
 * you swipe, #1 first. Both follow the live stream.
 */
export function LeaderboardBand({ model }: { model: HomeLeaderboardModel }) {
  return (
    <section aria-labelledby="top-orgs-heading" className="relative pt-section">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 max-md:flex-col max-md:items-center max-md:text-center">
          <div>
            <h2 id="top-orgs-heading" className="text-h1 font-bold text-balance text-ink">
              Top Organizations this Semester
            </h2>
            {model.semester ? (
              <p className="mt-2 text-lead text-ink-muted">{model.semester}</p>
            ) : null}
          </div>
          <LiveIndicator live={model.live} />
        </div>

        {/* Below lg: one podium at a time. */}
        <div
          role="group"
          aria-label="Show the Top 3 of"
          className="mt-8 flex justify-center lg:hidden"
        >
          <div className="inline-flex rounded-full border border-border bg-white p-1">
            {LEADERBOARD_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={model.shown === type}
                aria-controls={`top-${type}`}
                onClick={() => model.show(type)}
                className={cn(
                  'min-h-11 rounded-full px-6 text-body font-semibold text-ink transition-colors duration-300',
                  'hover:bg-accent focus-visible:bg-accent',
                  'aria-pressed:bg-forest-band aria-pressed:text-white',
                )}
              >
                {BOARD_LABELS[type].short}
                <span className="sr-only"> ({BOARD_LABELS[type].long})</span>
              </button>
            ))}
          </div>
        </div>

        {/* grid-cols-1: a shrinkable column, so the swipe row scrolls instead of widening it. */}
        <div className="mt-6 grid grid-cols-1 gap-x-12 lg:mt-12 lg:grid-cols-2">
          {LEADERBOARD_TYPES.map((type) => (
            <div
              key={type}
              id={`top-${type}`}
              className={cn(model.shown !== type && 'max-lg:hidden')}
            >
              <h3 className="text-center text-h3 font-semibold text-ink max-lg:sr-only">
                {BOARD_LABELS[type].long}
              </h3>
              <BandBoard type={type} board={model.boards[type]} />
            </div>
          ))}
        </div>

        <div className="mt-10 flex justify-center">
          <PillButton asChild size="lg">
            <OriginLink to="/leaderboard">View full leaderboard →</OriginLink>
          </PillButton>
        </div>
      </Container>
    </section>
  );
}

function BandBoard({ type, board }: { type: LeaderboardType; board: BoardState }) {
  if (board.status === 'loading') return <BoardSkeleton rows={0} className="mt-4" />;
  if (board.status === 'error') {
    return (
      <SectionError
        className="mt-6"
        message="The leaderboard could not be loaded. Check your connection and try again."
        onRetry={board.retry}
      />
    );
  }
  if (board.podium.length === 0) return <BoardEmpty className="py-6" />;
  return (
    <>
      {board.sample ? (
        <div className="mt-3 flex justify-center">
          <SampleDataChip />
        </div>
      ) : null}
      <Podium
        entries={board.podium}
        label={`Top 3 ${BOARD_LABELS[type].long}`}
        bursts={board.bursts}
        className="mt-2"
      />
    </>
  );
}
