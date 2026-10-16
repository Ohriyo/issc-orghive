import { useRef } from 'react';
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  ClipboardCheck,
  FileUp,
  Settings,
  ShieldAlert,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { OriginLink } from '@/navigation/origin-link';
import { UPLOAD_ACCEPT } from '@orghive/shared';
import { PillButton } from '@/components/pill-button';
import { StatusBadge } from '@/components/status-badge';
import { STATUS_STYLE } from '@/components/status-style';
import { cn } from '@/lib/utils';
import type {
  ActivityItem,
  RecentDocument,
  RevisionItem,
  RolePanel,
  StatTile,
} from '../presenters/use-dashboard';

const SECTION_TITLE = 'text-h3 font-bold text-ink';
const TEXT_LINK =
  'tap-area font-semibold text-ink underline decoration-1 underline-offset-4 transition-colors duration-300 hover:decoration-leaf focus-visible:decoration-leaf';
const dateFormat = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' });

/** Drafts, Pending review, Approved, Needs revision: each opens My documents on that tab. */
export function StatTiles({ tiles }: { tiles: StatTile[] }) {
  return (
    <ul aria-label="Documents by status" className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
      {tiles.map((tile) => {
        const alert = tile.status === 'rejected' && tile.count > 0;
        return (
          <li key={tile.status}>
            <OriginLink
              to={tile.href}
              aria-label={`${tile.label}, ${tile.count} ${tile.count === 1 ? 'document' : 'documents'}`}
              className={cn(
                'group flex h-full min-h-28 flex-col justify-between gap-3 rounded-2xl bg-white p-4 ring-1 ring-ink/10 md:p-5',
                'ease-cinematic shadow-pool transition-[translate,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-pool-lift focus-visible:-translate-y-0.5',
                'motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:focus-visible:translate-y-0',
                alert && 'ring-2 ring-destructive/40',
              )}
            >
              <span className="flex items-center gap-2 text-small font-semibold text-ink-muted">
                <span
                  aria-hidden="true"
                  className={cn('size-2.5', STATUS_STYLE[tile.status].dot)}
                />
                {tile.label}
              </span>
              <span
                className={cn(
                  'text-h1 leading-none font-bold tabular-nums',
                  alert ? 'text-destructive' : 'text-ink',
                )}
              >
                {tile.count}
              </span>
            </OriginLink>
          </li>
        );
      })}
    </ul>
  );
}

function ReviseControl({ item, onRevise }: { item: RevisionItem; onRevise: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const state = item.revise;
  const busy = state.status === 'uploading' || state.status === 'saving';
  return (
    <div className="flex flex-col gap-2 sm:items-end">
      <input
        ref={input}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onRevise(file);
        }}
      />
      <PillButton
        size="md"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="max-sm:w-full"
      >
        <FileUp aria-hidden="true" />
        Revise
        <span className="sr-only">: upload a new version of {item.title}</span>
      </PillButton>
      <div aria-live="polite" className="text-small sm:text-right">
        {state.status === 'uploading' || state.status === 'saving' ? (
          <div className="flex flex-col gap-1 sm:items-end">
            <div
              role="progressbar"
              aria-label={`Upload of a new version of ${item.title}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={state.status === 'saving' ? 100 : state.progress}
              className="h-1.5 w-full overflow-hidden rounded-full bg-surface-deep sm:w-40"
            >
              <div
                className="bg-forest-band h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${state.status === 'saving' ? 100 : state.progress}%` }}
              />
            </div>
            <span className="text-ink-muted">
              {state.status === 'saving' ? 'Saving…' : `Uploading ${state.progress}%`}
            </span>
          </div>
        ) : state.status === 'done' ? (
          <span className="text-ink">
            Uploaded. It goes back to review once the virus scan passes.
          </span>
        ) : state.status === 'error' ? (
          <span role="alert" className="font-medium text-destructive">
            {state.message}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Rejected documents with the reviewer's remark, and Revise for officers. */
export function NeedsAttention({
  items,
  canRevise,
  onRevise,
}: {
  items: RevisionItem[];
  canRevise: boolean;
  onRevise: (documentId: string, file: File) => void;
}) {
  return (
    <section aria-labelledby="attention-heading">
      <h2 id="attention-heading" className={SECTION_TITLE}>
        Needs your attention
      </h2>
      {items.length === 0 ? (
        <p className="mt-4 flex items-start gap-3 rounded-2xl bg-white/70 p-5 text-body text-ink ring-1 ring-ink/10">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-leaf" />
          Nothing needs a revision. Rejected documents show up here with the reviewer’s remarks.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-pool ring-1 ring-ink/10 sm:flex-row sm:items-start md:p-6"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status="rejected" />
                  <span className="text-small text-ink-muted">{item.typeLabel}</span>
                </div>
                <h3 className="mt-2 text-body-lg leading-snug font-semibold text-ink">
                  <OriginLink
                    to={item.href}
                    className="tap-area hover:underline focus-visible:underline"
                  >
                    {item.title}
                  </OriginLink>
                </h3>
                {item.remark ? (
                  <figure className="mt-3 rounded-2xl bg-surface p-4">
                    <blockquote className="text-body text-ink">“{item.remark}”</blockquote>
                    {item.decidedBy ? (
                      <figcaption className="mt-1.5 text-small text-ink-muted">
                        {item.decidedBy}
                      </figcaption>
                    ) : null}
                  </figure>
                ) : (
                  <p className="mt-3 text-body text-ink-muted">
                    The reviewer left no remark{item.decidedBy ? ` (${item.decidedBy})` : ''}.
                  </p>
                )}
              </div>
              {canRevise ? (
                <ReviseControl item={item} onRevise={(file) => onRevise(item.id, file)} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const ACTIVITY_ICON: Record<ActivityItem['kind'], { icon: LucideIcon; className: string }> = {
  upload: { icon: FileUp, className: 'text-ink' },
  approve: { icon: CheckCircle2, className: 'text-leaf' },
  reject: { icon: XCircle, className: 'text-destructive' },
  quarantine: { icon: ShieldAlert, className: 'text-destructive' },
  archive: { icon: Archive, className: 'text-ink-muted' },
  restore: { icon: ArchiveRestore, className: 'text-ink' },
};

/** The last uploads and decisions; before any are recorded, the latest documents. */
export function RecentActivity({
  activity,
  recentDocuments,
  documentsHref,
}: {
  activity: ActivityItem[];
  recentDocuments: RecentDocument[];
  documentsHref: string;
}) {
  return (
    <section aria-labelledby="activity-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="activity-heading" className={SECTION_TITLE}>
          Recent activity
        </h2>
        <OriginLink to={documentsHref} className={cn(TEXT_LINK, 'text-small')}>
          All documents
        </OriginLink>
      </div>
      {activity.length > 0 ? (
        <ol className="mt-4 flex flex-col rounded-2xl bg-white px-5 ring-1 ring-ink/10">
          {activity.map((item) => {
            const { icon: Icon, className } = ACTIVITY_ICON[item.kind];
            return (
              <li key={item.id} className="flex gap-3 border-t border-border py-4 first:border-t-0">
                <Icon aria-hidden="true" className={cn('mt-0.5 size-5 shrink-0', className)} />
                <div className="min-w-0 flex-1">
                  <p className="text-body break-words text-ink">
                    {item.lead}{' '}
                    {item.documentHref ? (
                      <OriginLink to={item.documentHref} className={TEXT_LINK}>
                        {item.documentTitle}
                      </OriginLink>
                    ) : (
                      <span className="text-ink-muted">{item.documentTitle}</span>
                    )}
                  </p>
                  <time dateTime={item.at} className="mt-0.5 block text-small text-ink-muted">
                    {item.ago}
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
      ) : recentDocuments.length > 0 ? (
        <>
          <p className="mt-2 text-small text-ink-muted">
            No uploads or decisions recorded yet. The latest documents:
          </p>
          <ul className="mt-3 flex flex-col rounded-2xl bg-white px-5 ring-1 ring-ink/10">
            {recentDocuments.map((doc) => (
              <li
                key={doc.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border py-4 first:border-t-0"
              >
                <OriginLink to={doc.href} className={cn(TEXT_LINK, 'min-w-0 flex-1 break-words')}>
                  {doc.title}
                </OriginLink>
                <StatusBadge status={doc.status} />
                <time dateTime={doc.date} className="w-full text-small text-ink-muted">
                  Added {dateFormat.format(new Date(doc.date))}
                </time>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-4 text-body text-ink-muted">No uploads or decisions yet.</p>
      )}
    </section>
  );
}

/** Extra work that comes with a role. Each panel renders only when its role applies. */
export function RolePanels({ panels }: { panels: RolePanel[] }) {
  if (panels.length === 0) return null;
  return (
    <section aria-label="Your other roles" className="flex flex-col gap-4">
      {panels.map((panel) =>
        panel.kind === 'reviews' ? (
          <div
            key="reviews"
            className="bg-forest-sheen flex flex-col gap-4 rounded-2xl p-5 text-white shadow-pool md:flex-row md:items-center md:justify-between md:gap-8 md:p-6"
          >
            <div className="flex items-start gap-4">
              <ClipboardCheck aria-hidden="true" className="mt-1 size-6 shrink-0" />
              <div>
                <h2 className="text-body-lg font-semibold">Pending reviews</h2>
                <p className="mt-1 text-body text-white/90">
                  <span className="text-h2 leading-none font-bold tabular-nums text-white">
                    {panel.pending}
                  </span>{' '}
                  {panel.pending === 1 ? 'document is' : 'documents are'} waiting for your decision,
                  from the {panel.organizations}{' '}
                  {panel.organizations === 1 ? 'organization' : 'organizations'} you review.
                </p>
              </div>
            </div>
            <PillButton asChild variant="light" size="md" className="self-start md:self-center">
              <OriginLink to={panel.href}>Open review queue</OriginLink>
            </PillButton>
          </div>
        ) : (
          <div
            key="admin"
            className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-pool ring-1 ring-ink/10 md:flex-row md:items-center md:justify-between md:gap-8 md:p-6"
          >
            <div className="flex items-start gap-4">
              <Settings aria-hidden="true" className="mt-1 size-6 shrink-0 text-ink" />
              <div>
                <h2 className="text-body-lg font-semibold text-ink">Administration</h2>
                <p className="mt-1 text-body text-ink-muted">
                  Organizations, memberships and accounts across Orghive.
                </p>
              </div>
            </div>
            <PillButton asChild size="md" className="self-start md:self-center">
              <OriginLink to={panel.href}>Open admin</OriginLink>
            </PillButton>
          </div>
        ),
      )}
    </section>
  );
}
