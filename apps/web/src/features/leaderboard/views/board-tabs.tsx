import { Tabs } from 'radix-ui';
import { LEADERBOARD_TYPES } from '@orghive/shared';
import { cn } from '@/lib/utils';
import { BOARD_LABELS } from '../presenters/leaderboard-model';

/**
 * SBO | CSC as a segmented pill (Radix tabs: arrow keys move between them). Must sit in a
 * `Tabs.Root` whose values are the board types.
 */
export function BoardTabsList({ label, className }: { label: string; className?: string }) {
  return (
    <Tabs.List
      aria-label={label}
      className={cn(
        'inline-flex w-full rounded-full border border-border bg-white p-1 sm:w-auto',
        className,
      )}
    >
      {LEADERBOARD_TYPES.map((type) => (
        <Tabs.Trigger
          key={type}
          value={type}
          className={cn(
            'min-h-11 flex-1 rounded-full px-6 text-body font-semibold text-ink transition-colors duration-300 sm:flex-none',
            'hover:bg-accent focus-visible:bg-accent',
            'data-[state=active]:bg-forest-band data-[state=active]:text-white',
          )}
        >
          {BOARD_LABELS[type].short}
          <span className="sr-only"> ({BOARD_LABELS[type].long})</span>
        </Tabs.Trigger>
      ))}
    </Tabs.List>
  );
}
