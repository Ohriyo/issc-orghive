import { AlertTriangle, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { IntegrityStatus, IntegrityTone } from '../presenters/task-integrity';

const INTEGRITY_STYLE: Record<IntegrityTone, { icon: typeof Loader2; className: string }> = {
  pending: { icon: Loader2, className: 'text-ink-muted' },
  ok: { icon: ShieldCheck, className: 'text-forest-700' },
  warn: { icon: AlertTriangle, className: 'text-caution' },
  bad: { icon: ShieldAlert, className: 'text-destructive' },
};

/** "Verified ✓" or "Needs attention: …": a task file's checks (spec section 6). */
export function IntegrityLine({ status }: { status: IntegrityStatus }) {
  const style = INTEGRITY_STYLE[status.tone];
  const Icon = style.icon;
  const boxed = status.tone === 'warn' || status.tone === 'bad';
  return (
    <div
      aria-live="polite"
      className={cn(
        'flex flex-col gap-1',
        boxed && 'mt-1 rounded-xl p-3',
        status.tone === 'warn' && 'bg-caution-surface',
        status.tone === 'bad' && 'bg-surface-deep/40',
      )}
    >
      <span className={cn('inline-flex items-center gap-1.5 font-semibold', style.className)}>
        <Icon
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0',
            status.tone === 'pending' && 'animate-spin motion-reduce:animate-none',
          )}
        />
        {status.label}
      </span>
      {status.reasons.length > 0 ? (
        <ul className="ml-5 list-disc text-ink">
          {status.reasons.map((reason) => (
            <li key={reason} className="break-words">
              {reason}
            </li>
          ))}
        </ul>
      ) : null}
      {status.advice ? <p className="text-ink-muted">{status.advice}</p> : null}
    </div>
  );
}
