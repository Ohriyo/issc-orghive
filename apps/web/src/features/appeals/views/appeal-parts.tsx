import { CheckCircle2, Clock, FileText, ShieldAlert, XCircle } from 'lucide-react';
import type { AppealStatus } from '@orghive/shared';
import { cn } from '@/lib/utils';
import type { AppealAttachmentItem, AppealItem } from '../presenters/appeal-format';

const STATUS_STYLE: Record<AppealStatus, { icon: typeof Clock; className: string }> = {
  pending: { icon: Clock, className: 'border-olive text-ink' },
  approved: { icon: CheckCircle2, className: 'border-leaf text-ink' },
  rejected: { icon: XCircle, className: 'border-destructive text-destructive' },
};

/** The appeal's status as a chip: icon and words, never color alone. */
export function AppealStatusChip({ status, label }: { status: AppealStatus; label: string }) {
  const { icon: Icon, className } = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-white px-2.5 py-0.5 text-caption font-semibold',
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </span>
  );
}

/** The supporting files: each opens a 5-minute download link (clean files only). */
export function AppealAttachments({
  attachments,
  onOpen,
}: {
  attachments: AppealAttachmentItem[];
  onOpen: (attachmentId: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div>
      <h4 className="text-small font-semibold text-ink">Supporting files</h4>
      <ul className="mt-1 flex flex-col">
        {attachments.map((a) => (
          <li key={a.id}>
            {a.canOpen ? (
              <button
                type="button"
                onClick={() => onOpen(a.id)}
                className="group flex min-h-11 max-w-full cursor-pointer items-center gap-2 text-left text-small font-medium text-ink"
              >
                <FileText aria-hidden="true" className="size-4 shrink-0 text-forest-700" />
                <span className="min-w-0 break-all underline decoration-1 underline-offset-4 group-hover:decoration-leaf group-focus-visible:decoration-leaf">
                  {a.filename}
                </span>
                <span className="shrink-0 text-ink-muted">({a.size})</span>
              </button>
            ) : (
              <span className="flex min-h-11 items-center gap-2 text-small text-ink-muted">
                <ShieldAlert aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 break-all">{a.filename}</span>
                {a.scanStatus === 'pending' ? '(being checked)' : '(refused by the virus scan)'}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What was appealed and why, and the decision once there is one. */
export function AppealDetails({
  appeal,
  onOpenAttachment,
}: {
  appeal: AppealItem;
  onOpenAttachment: (attachmentId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-small text-ink-muted">
        {appeal.detail}. {appeal.submitted}.
      </p>
      <blockquote className="border-l-4 border-ink/15 pl-3 text-body break-words whitespace-pre-line text-ink">
        {appeal.reason}
      </blockquote>
      <AppealAttachments attachments={appeal.attachments} onOpen={onOpenAttachment} />
      {appeal.decided ? (
        <div
          className={cn(
            'rounded-xl p-3 text-body',
            appeal.status === 'rejected' ? 'bg-destructive/10 text-ink' : 'bg-surface text-ink',
          )}
        >
          <p className="font-semibold">{appeal.decided}</p>
          {appeal.newDue ? <p className="mt-1">{appeal.newDue}</p> : null}
          {appeal.remarks ? (
            <p className="mt-1 break-words whitespace-pre-line">
              <span className="font-medium">Remarks: </span>
              {appeal.remarks}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
