import { cn } from '@/lib/utils';

/** A placeholder bar while content loads. Size and shape come from the caller. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse rounded-full bg-surface-deep motion-reduce:animate-none',
        className,
      )}
    />
  );
}
