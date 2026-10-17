import type { DocumentStatus } from '@orghive/shared';

/**
 * Label plus a shape cue, so status never relies on color alone. Nothing is reviewed: a
 * document is scanned, then available (or quarantined when the scan refuses it).
 */
export const STATUS_STYLE: Record<
  DocumentStatus,
  { label: string; className: string; dot: string }
> = {
  scanning: {
    label: 'Scanning',
    className: 'border-olive text-ink',
    dot: 'rounded-full bg-olive',
  },
  available: {
    label: 'Available',
    className: 'border-leaf text-ink',
    dot: 'rounded-full bg-leaf',
  },
  quarantined: {
    label: 'Blocked by virus scan',
    className: 'border-destructive/60 text-destructive',
    dot: 'rotate-45 rounded-[1px] bg-destructive',
  },
  archived: {
    label: 'Archived',
    className: 'border-ink/25 text-ink-muted',
    dot: 'rounded-sm border border-ink-muted',
  },
};
