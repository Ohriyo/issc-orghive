import { useId } from 'react';
import { Tabs } from 'radix-ui';
import type { LeaderboardType } from '@orghive/shared';
import { Container } from '@/components/container';
import { FilterSelect } from '@/components/filter-bar';
import { SectionError } from '@/components/section-error';
import { BOARD_LABELS } from '../presenters/leaderboard-model';
import type { BoardState, LeaderboardPageModel } from '../presenters/use-leaderboard-views';
import { BoardEmpty, BoardSkeleton } from './board-states';
import { Podium } from './podium';
import { LiveIndicator } from './standing-marks';
import { StandingsList } from './standings-list';
import { BoardTabsList } from './board-tabs';

/**
 * /leaderboard: one board (SBO or CSC, never combined: spec 5A) of a semester. The Top 3
 * stand on the podium; everyone else follows in a list, both live.
 */
export function LeaderboardView({ model }: { model: LeaderboardPageModel }) {
  const id = useId();
  const semesterLabel = model.semester.options.find((o) => o.value === model.semester.value)?.label;
  return (
    <div className="bg-surface-sweep min-h-page">
      <title>{`${model.boardLabel} leaderboard | Orghive`}</title>
      <Container as="main" className="pt-6 pb-section lg:pt-10">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <h1 className="text-h1 font-bold text-ink">Leaderboard</h1>
            <p className="mt-2 text-lead text-ink-muted">{semesterLabel}</p>
          </div>
          <LiveIndicator live={model.live} />
        </div>

        <Tabs.Root
          value={model.type}
          onValueChange={(value) => model.setType(value as LeaderboardType)}
          className="mt-8"
        >
          <div className="grid gap-4 md:grid-cols-[auto_minmax(0,16rem)_minmax(0,12rem)] md:items-end">
            <BoardTabsList label="Board" className="md:justify-self-start" />
            <FilterSelect
              id={`${id}-semester`}
              label="Semester"
              value={model.semester.value}
              options={model.semester.options}
              onChange={model.setSemester}
            />
            {model.college ? (
              <FilterSelect
                id={`${id}-college`}
                label="College"
                all="All colleges"
                value={model.college.value}
                options={model.college.options}
                onChange={model.setCollege}
              />
            ) : null}
          </div>

          <Tabs.Content value={model.type} className="mt-10 outline-none">
            <h2 className="sr-only">{model.boardLabel}</h2>
            <BoardBody
              board={model.board}
              type={model.type}
              filtered={Boolean(model.college?.value)}
            />
          </Tabs.Content>
        </Tabs.Root>
      </Container>
    </div>
  );
}

function BoardBody({
  board,
  type,
  filtered,
}: {
  board: BoardState;
  type: LeaderboardType;
  filtered: boolean;
}) {
  if (board.status === 'loading') return <BoardSkeleton rows={4} />;
  if (board.status === 'error') {
    return (
      <SectionError
        message="The leaderboard could not be loaded. Check your connection and try again."
        onRetry={board.retry}
      />
    );
  }
  const empty = board.podium.length === 0 && board.list.length === 0;
  return (
    <>
      {empty ? (
        filtered ? (
          <BoardEmpty
            title="No organization of this college is ranked yet"
            detail="Pick another college, or show all colleges."
          />
        ) : (
          <BoardEmpty />
        )
      ) : (
        <>
          {board.podium.length > 0 ? (
            <Podium
              entries={board.podium}
              label={`Top 3 ${BOARD_LABELS[type].long}`}
              bursts={board.bursts}
              className="mx-auto max-w-3xl"
            />
          ) : null}
          <div className="mt-10">
            <StandingsList
              rows={board.list}
              label={`${BOARD_LABELS[type].long} ranked ${board.podium.length + 1} and below`}
              start={board.podium.length + 1}
            />
          </div>
        </>
      )}
      <p className="mt-6 max-w-3xl text-small text-pretty text-ink-muted">{board.note}</p>
    </>
  );
}
