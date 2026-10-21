import { useRef } from 'react';
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Eye,
  FileUp,
  Gavel,
  ListChecks,
  BookOpen,
  Settings,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import { OriginLink } from '@/navigation/origin-link';
import { UPLOAD_ACCEPT } from '@orghive/shared';
import { PillButton } from '@/components/pill-button';
import { ActingAsField } from '@/components/acting-as-field';
import type { ActingAsModel } from '@/features/auth/presenters/use-acting-as';
import { StatusBadge } from '@/components/status-badge';
import { STATUS_STYLE } from '@/components/status-style';
import { cn } from '@/lib/utils';
import type {
  ActivityItem,
  SemesterView,
  AttentionItem,
  RecentDocument,
  RolePanel,
  StatTile,
  TileKey,
} from '../presenters/use-dashboard';

const SECTION_TITLE = 'text-h3 font-bold text-ink';
const TEXT_LINK =
  'tap-area font-semibold text-ink underline decoration-1 underline-offset-4 transition-colors duration-300 hover:decoration-leaf focus-visible:decoration-leaf';
const dateFormat = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' });

/** A shape cue per tile, so a tile never relies on color alone. */
const TILE_DOT: Record<TileKey, string> = {
  public: 'rounded-full bg-leaf',
  governing: 'rounded-full border-2 border-leaf',
  private: 'rounded-sm bg-ink-muted',
  quarantined: STATUS_STYLE.quarantined.dot,
};

/** Public, Governing bodies, Private, Blocked by scan: each opens My documents filtered to it. */
export function StatTiles({ tiles }: { tiles: StatTile[] }) {
  return (
    <ul
      aria-label="Documents by who can see them"
      className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4"
    >
      {tiles.map((tile) => {
        const alert = tile.alert;
        return (
          <li key={tile.key}>
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
                <span aria-hidden="true" className={cn('size-2.5', TILE_DOT[tile.key])} />
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

function ReviseControl({
  item,
  onRevise,
}: {
  item: AttentionItem;
  onRevise: (file: File) => void;
}) {
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
        Upload a clean copy
        <span className="sr-only">: of {item.title}</span>
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
            Uploaded. It is shared as you chose once the virus scan passes.
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

/** The user's own uploads the virus scan blocked, with a way to upload a clean copy. */
export function NeedsAttention({
  items,
  canRevise,
  onRevise,
  actingAs,
  orgAcronym,
}: {
  items: AttentionItem[];
  canRevise: boolean;
  onRevise: (documentId: string, file: File) => void;
  actingAs: ActingAsModel;
  orgAcronym: string;
}) {
  return (
    <section aria-labelledby="attention-heading">
      <h2 id="attention-heading" className={SECTION_TITLE}>
        Needs your attention
      </h2>
      {items.length === 0 ? (
        <p className="mt-4 flex items-start gap-3 rounded-2xl bg-white/70 p-5 text-body text-ink ring-1 ring-ink/10">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-leaf" />
          Nothing needs you. If the virus scan blocks one of your uploads, it shows up here.
        </p>
      ) : (
        <>
          {canRevise ? (
            <ActingAsField
              className="mt-4 max-w-md"
              orgAcronym={orgAcronym}
              value={actingAs.value}
              onChange={(event) => actingAs.onChange(event.target.value)}
              error={actingAs.error}
            />
          ) : null}
          <ul className="mt-4 flex flex-col gap-4">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-pool ring-1 ring-ink/10 sm:flex-row sm:items-start md:p-6"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status="quarantined" />
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
                  <p className="mt-3 text-body text-ink-muted">
                    The virus scan refused this file, so nobody else can see it. Upload a clean copy
                    to share it.
                  </p>
                </div>
                {canRevise ? (
                  <ReviseControl item={item} onRevise={(file) => onRevise(item.id, file)} />
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

const ACTIVITY_ICON: Record<ActivityItem['kind'], { icon: LucideIcon; className: string }> = {
  upload: { icon: FileUp, className: 'text-ink' },
  quarantine: { icon: ShieldAlert, className: 'text-destructive' },
  archive: { icon: Archive, className: 'text-ink-muted' },
  restore: { icon: ArchiveRestore, className: 'text-ink' },
  visibility_change: { icon: Eye, className: 'text-ink' },
};

/** The latest activity; before any is recorded, the latest documents. */
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
                  {item.actedBy ? (
                    <p className="mt-0.5 text-small break-words text-ink-muted">{item.actedBy}</p>
                  ) : null}
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
            No activity recorded yet. The latest documents:
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
        <p className="mt-4 text-body text-ink-muted">No uploads yet.</p>
      )}
    </section>
  );
}

/**
 * "This semester" for an officer: the organization's projects by status, and the next three
 * deadlines with how far off each is. One panel, so it reads as one summary.
 */
export function ThisSemester({ semester }: { semester: SemesterView }) {
  const total = semester.counts.reduce((sum, c) => sum + c.count, 0);
  return (
    <section
      aria-labelledby="semester-heading"
      className="grid gap-6 rounded-2xl bg-white p-5 shadow-pool ring-1 ring-ink/10 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-10 md:p-6"
    >
      <div>
        <h2 id="semester-heading" className={SECTION_TITLE}>
          This semester
        </h2>
        <p className="mt-1 text-small text-ink-muted">{semester.label}</p>
        {total === 0 ? (
          <p className="mt-4 text-body text-ink">No projects with an event this semester yet.</p>
        ) : (
          <dl className="mt-4 grid grid-cols-3 divide-x divide-border">
            {semester.counts.map((c) => (
              <div key={c.status} className="px-3 first:pl-0">
                <dt className="text-small text-ink-muted">{c.label}</dt>
                <dd
                  className={cn(
                    'mt-1 text-h2 leading-none font-bold tabular-nums',
                    c.status === 'blocked' && c.count > 0 ? 'text-destructive' : 'text-ink',
                  )}
                >
                  {c.count}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <OriginLink
          to={semester.projectsHref}
          className={cn(TEXT_LINK, 'mt-5 inline-block text-small')}
        >
          All projects
        </OriginLink>
      </div>
      <div>
        <h3 className="text-body font-semibold text-ink">Next deadlines</h3>
        {semester.deadlines.length === 0 ? (
          <p className="mt-3 text-body text-ink-muted">Nothing is due. Every open task is filed.</p>
        ) : (
          <ol className="mt-2 flex flex-col">
            {semester.deadlines.map((d) => (
              <li
                key={d.key}
                className="flex items-baseline gap-4 border-t border-border py-3 first:border-t-0"
              >
                <time
                  dateTime={d.dueAt}
                  className={cn(
                    'w-28 shrink-0 text-small font-semibold tabular-nums',
                    d.soon ? 'text-caution' : 'text-ink',
                  )}
                >
                  {d.dueLabel}
                  <span className="block font-normal text-ink-muted">{d.when}</span>
                </time>
                <span className="min-w-0">
                  <span className="block text-body font-medium text-ink">{d.task}</span>
                  {/* Its own 44px line: tap-area alone leaves small text under the minimum. */}
                  <OriginLink
                    to={d.href}
                    className={cn(
                      TEXT_LINK,
                      'inline-flex min-h-11 items-center text-small break-words',
                    )}
                  >
                    {d.projectName}
                  </OriginLink>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

/** Extra work that comes with a role. Each panel renders only when its role applies. */
const PANEL_TEXT: Record<
  RolePanel['kind'],
  { icon: LucideIcon; title: string; body: string; action: string }
> = {
  appeals: {
    icon: Gavel,
    title: 'Appeals',
    body: 'Blocked projects and frozen organizations waiting for your decision.',
    action: 'Open appeals',
  },
  overview: {
    icon: ListChecks,
    title: 'Compliance overview',
    body: 'Projects, deadlines, freezes and appeals of the organizations your council oversees.',
    action: 'Open overview',
  },
  admin: {
    icon: Settings,
    title: 'Administration',
    body: 'Organizations, memberships and accounts across Orghive.',
    action: 'Open admin',
  },
  handbook: {
    icon: BookOpen,
    title: 'Student Handbook',
    body: 'Upload each academic year’s edition and choose the current one.',
    action: 'Manage the handbook',
  },
};

export function RolePanels({ panels }: { panels: RolePanel[] }) {
  if (panels.length === 0) return null;
  return (
    <section aria-label="Your other roles" className="flex flex-col gap-4">
      {panels.map((panel) => {
        const text = PANEL_TEXT[panel.kind];
        const Icon = text.icon;
        return (
          <div
            key={panel.kind}
            className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-pool ring-1 ring-ink/10 md:flex-row md:items-center md:justify-between md:gap-8 md:p-6"
          >
            <div className="flex items-start gap-4">
              <Icon aria-hidden="true" className="mt-1 size-6 shrink-0 text-ink" />
              <div>
                <h2 className="text-body-lg font-semibold text-ink">{text.title}</h2>
                <p className="mt-1 text-body text-ink-muted">{text.body}</p>
              </div>
            </div>
            <PillButton asChild size="md" className="self-start md:self-center">
              <OriginLink to={panel.href}>{text.action}</OriginLink>
            </PillButton>
          </div>
        );
      })}
    </section>
  );
}
