import { AlertTriangle, CheckCircle2, Clock, Lock, OctagonAlert } from 'lucide-react';
import type { ProjectStatus } from '@orghive/shared';
import { cn } from '@/lib/utils';
import type { DeadlineLabel } from '../presenters/project-format';

const CHIP =
  'inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-white px-2.5 py-0.5 text-caption font-semibold';

const STATUS_CHIP: Record<ProjectStatus, { className: string; icon: typeof Clock }> = {
  active: { className: 'border-olive text-ink', icon: Clock },
  blocked: { className: 'border-destructive/60 text-destructive', icon: OctagonAlert },
  completed: { className: 'border-leaf text-ink', icon: CheckCircle2 },
};

/** A project's status as a small outlined pill: icon plus words, never color alone. */
export function ProjectStatusChip({ status, label }: { status: ProjectStatus; label: string }) {
  const { className, icon: Icon } = STATUS_CHIP[status];
  return (
    <span className={cn(CHIP, className)}>
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </span>
  );
}

const DEADLINE_STYLE: Record<DeadlineLabel['tone'], string> = {
  neutral: 'text-ink-muted',
  soon: 'rounded-full bg-caution-surface px-2.5 py-0.5 text-caution',
  overdue: 'rounded-full bg-destructive/10 px-2.5 py-0.5 text-destructive',
};

/** "Due in 5 days" with the date it falls on; urgent ones are highlighted with an icon. */
export function DeadlineBadge({ deadline, prefix }: { deadline: DeadlineLabel; prefix?: string }) {
  const Icon = deadline.tone === 'neutral' ? Clock : AlertTriangle;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-small font-medium',
        DEADLINE_STYLE[deadline.tone],
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span>
        {prefix ? `${prefix} ` : ''}
        {deadline.text}
        <span className="font-normal">
          {' '}
          (<time dateTime={deadline.iso}>{deadline.date}</time>)
        </span>
      </span>
    </span>
  );
}

/** Locked tasks say why. */
export function LockedNote({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-small text-ink-muted">
      <Lock aria-hidden="true" className="size-4 shrink-0" />
      {text}
    </span>
  );
}
