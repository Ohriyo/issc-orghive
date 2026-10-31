import { FlaskConical } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Marks demo data (db:seed:demo) where the public sees it: the leaderboard podiums and the
 * demo organizations' pages. Small and quiet on purpose; it only says the figures are samples.
 */
export function SampleDataChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-caution-surface px-2.5 py-0.5 text-caption font-semibold text-caution',
        className,
      )}
    >
      <FlaskConical aria-hidden="true" className="size-3.5" />
      Sample data
    </span>
  );
}
