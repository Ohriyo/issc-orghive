import type { DocumentStatus } from '@orghive/shared';
import { cn } from '@/lib/utils';
import { STATUS_STYLE } from './status-style';

/** A document's lifecycle status as a small outlined pill. */
export function StatusBadge({ status, className }: { status: DocumentStatus; className?: string }) {
  const style = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-white px-2.5 py-0.5 text-caption font-semibold',
        style.className,
        className,
      )}
    >
      <span aria-hidden="true" className={cn('size-2', style.dot)} />
      {style.label}
    </span>
  );
}
