import type { DocumentStatus } from '@orghive/shared';

/** Label plus a shape cue, so status never relies on color alone. */
export const STATUS_STYLE: Record<
  DocumentStatus,
  { label: string; className: string; dot: string }
> = {
  draft: {
    label: 'Draft',
    className: 'border-ink/25 text-ink-muted',
    dot: 'rounded-sm bg-ink-muted/60',
  },
  pending: {
    label: 'Pending review',
    className: 'border-olive text-ink',
    dot: 'rounded-full bg-olive',
  },
  approved: {
    label: 'Approved',
    className: 'border-leaf text-ink',
    dot: 'rounded-full bg-leaf',
  },
  rejected: {
    label: 'Rejected',
    className: 'border-destructive/60 text-destructive',
    dot: 'rotate-45 rounded-[1px] bg-destructive',
  },
  archived: {
    label: 'Archived',
    className: 'border-ink/25 text-ink-muted',
    dot: 'rounded-sm border border-ink-muted',
  },
};
