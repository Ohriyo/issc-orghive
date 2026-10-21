import { HexFrame } from '@/components/hex-frame';
import { Skeleton } from '@/components/skeleton';
import { cn } from '@/lib/utils';

/** The podium's three cells and a few rows, while the board loads. */
export function BoardSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div aria-busy="true" className={className}>
      <p className="sr-only">Loading the leaderboard</p>
      <div className="flex items-start justify-center gap-4 pt-8 md:gap-8">
        {[false, true, false].map((first, i) => (
          <div
            key={i}
            className={cn('flex flex-col items-center gap-3', !first && 'mt-12 max-md:hidden')}
          >
            <HexFrame
              band={false}
              ring={false}
              shadow={false}
              className={cn(
                'animate-pulse opacity-30 motion-reduce:animate-none',
                first ? 'w-44' : 'w-32',
              )}
            />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-32" />
          </div>
        ))}
      </div>
      {rows > 0 ? (
        <div className="mt-8 space-y-3">
          {Array.from({ length: rows }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-3xl" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A board with nobody ranked yet: three empty cells waiting to be filled, and what it
 * takes to appear.
 */
export function BoardEmpty({
  title = 'Rankings appear once organizations complete their first projects',
  detail = 'A project counts once its event has passed and its ACR and Financial Report are in.',
  className,
}: {
  title?: string;
  detail?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center py-10 text-center', className)}>
      <div aria-hidden="true" className="flex items-end gap-2">
        <HexFrame band={false} ring={false} shadow={false} className="w-14 opacity-20" />
        <HexFrame band={false} ring={false} shadow={false} className="mb-6 w-20 opacity-30" />
        <HexFrame band={false} ring={false} shadow={false} className="w-14 opacity-20" />
      </div>
      <p className="mt-6 max-w-md text-lead font-semibold text-balance text-ink">{title}</p>
      <p className="mt-2 max-w-md text-body text-pretty text-ink-muted">{detail}</p>
    </div>
  );
}
