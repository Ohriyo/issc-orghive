import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import type { Destination } from './origin';
import { useBackNavigation } from './use-back-navigation';

export interface BackButtonProps {
  /** The screen's logical parent, used when the user did not come from another page. */
  parent: Destination | null;
  className?: string;
}

/**
 * The one back control in the app: "‹ Dashboard". A real link to where the user came from
 * (or the logical parent), so it also works with middle-click and never leaves the site.
 */
export function BackButton({ parent, className }: BackButtonProps) {
  const { target } = useBackNavigation(parent);
  if (!target) return null;
  return (
    <Link
      to={target.path}
      aria-label={`Back to ${target.label}`}
      className={cn(
        'group -ml-1.5 inline-flex min-h-11 max-w-full items-center gap-1 rounded-full pr-3 pl-1 text-body font-semibold text-ink transition-colors duration-300 hover:bg-white/70 focus-visible:bg-white/70',
        className,
      )}
    >
      <ChevronLeft
        aria-hidden="true"
        className="ease-cinematic size-5 shrink-0 transition-transform duration-300 group-hover:-translate-x-0.5 group-focus-visible:-translate-x-0.5 motion-reduce:transition-none"
      />
      <span className="truncate">{target.label}</span>
    </Link>
  );
}
