import { useState } from 'react';
import { Link } from 'react-router';
import type { DocumentStatus } from '@orghive/shared';
import { cn } from '@/lib/utils';
import { HexFrame } from './hex-frame';
import { OrgLogo } from './org-logo';

/** The upload allow-list from CLAUDE.md. */
export type DocumentFileType = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'jpg' | 'png';

export interface DocumentCardProps {
  title: string;
  /** Display label from the document type, e.g. "Accomplishment report". Not hard-coded here. */
  typeLabel: string;
  /** ISO date string. */
  date: string;
  href: string;
  fileType: DocumentFileType;
  /** First-page preview. Without it (or if it fails) the card shows the file type in a hexagon. */
  thumbnailSrc?: string;
  /** Decided by the presenter; the card only renders it. */
  isNew?: boolean;
  /** The organization that owns the document. Its hexagon seal sits on the card's band. */
  org?: { name: string; logoSrc?: string; shortName?: string };
  /**
   * Lifecycle status, for officers and advisers browsing their own Paperworks. Omit it on
   * public lists. Which viewers may see which status is decided by the presenter.
   */
  status?: DocumentStatus;
  className?: string;
}

/** Label plus a shape cue, so status never relies on color alone. */
const STATUS_STYLE: Record<DocumentStatus, { label: string; className: string; dot: string }> = {
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
  approved: { label: 'Approved', className: 'border-leaf text-ink', dot: 'rounded-full bg-leaf' },
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

const dateFormat = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' });

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateFormat.format(date);
}

/**
 * A Paperworks entry: preview, type, title and date. The whole card is one link.
 * Below 640 px it becomes a compact row so a list of documents stays scannable on a phone.
 */
export function DocumentCard({
  title,
  typeLabel,
  date,
  href,
  fileType,
  thumbnailSrc,
  isNew = false,
  org,
  status,
  className,
}: DocumentCardProps) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const showThumbnail = thumbnailSrc && !thumbnailFailed;
  const extension = fileType.toUpperCase();

  return (
    <article
      className={cn(
        'group relative flex overflow-hidden rounded-xl bg-white shadow-pool ring-1 ring-ink/10 sm:flex-col',
        'ease-cinematic transition-[translate,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-pool-lift',
        'has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-ink',
        'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        className,
      )}
    >
      <div className="relative w-24 shrink-0 overflow-hidden bg-surface sm:aspect-4/3 sm:w-full">
        {showThumbnail ? (
          <img
            src={thumbnailSrc}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setThumbnailFailed(true)}
            className="ease-cinematic size-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none"
          />
        ) : (
          <div className="grid size-full place-items-center p-2">
            <HexFrame className="w-16 sm:w-24" shadow={false} contentClassName="p-0">
              <span className="text-caption font-semibold tracking-wide text-white sm:text-small">
                {extension}
              </span>
            </HexFrame>
          </div>
        )}
      </div>

      {/* The forest band runs down the side on phones and across the top from 640 px. */}
      <div aria-hidden="true" className="bg-forest-band w-1.5 shrink-0 sm:h-1.5 sm:w-auto" />

      <div className="relative flex min-w-0 flex-1 flex-col gap-1.5 p-4">
        {org && (
          // The organization's seal straddles the forest band from 640 px up.
          <HexFrame
            ringWidth={2.5}
            className="absolute -top-7 right-4 hidden w-14 sm:block"
            contentClassName="p-[14%]"
          >
            <OrgLogo
              name={org.name}
              src={org.logoSrc}
              alt=""
              fallbackText={org.shortName}
              className="size-full"
            />
          </HexFrame>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:pr-14">
          <span
            title={typeLabel}
            className="max-w-full truncate rounded-full bg-ink px-2.5 py-1 text-caption font-semibold text-white"
          >
            {typeLabel}
          </span>
          {status && (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-0.5 text-caption font-semibold',
                STATUS_STYLE[status].className,
              )}
            >
              <span aria-hidden="true" className={cn('size-2', STATUS_STYLE[status].dot)} />
              {STATUS_STYLE[status].label}
            </span>
          )}
        </div>
        <h3 className="mt-1 line-clamp-2 text-body-lg leading-snug font-semibold text-ink">
          <Link
            to={href}
            className="after:absolute after:inset-0 focus-visible:shadow-none focus-visible:outline-none"
          >
            {title}
          </Link>
        </h3>
        {org && (
          <p className="flex items-center gap-2 text-small text-ink-muted">
            {/* On phones the seal moves inline beside the name. */}
            <HexFrame
              band={false}
              ring={false}
              shadow={false}
              className="w-6 sm:hidden"
              contentClassName="p-[12%]"
            >
              <OrgLogo
                name={org.name}
                src={org.logoSrc}
                alt=""
                fallbackText={org.shortName}
                className="size-full"
              />
            </HexFrame>
            {org.name}
          </p>
        )}
        <p className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-small text-ink-muted">
          <time dateTime={date}>{formatDate(date)}</time>
          <span>{extension}</span>
          {isNew && (
            <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-leaf" />
              New
            </span>
          )}
        </p>
      </div>
    </article>
  );
}

/** Loading placeholder with the same footprint as a DocumentCard. */
export function DocumentCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex animate-pulse overflow-hidden rounded-xl bg-white ring-1 ring-ink/10 motion-reduce:animate-none sm:flex-col',
        className,
      )}
    >
      <div className="w-24 shrink-0 bg-surface-deep/50 sm:aspect-4/3 sm:w-full" />
      <div className="w-1.5 bg-surface-deep sm:h-1.5 sm:w-auto" />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="h-5 w-24 rounded-full bg-surface-deep/70" />
        <div className="h-4 w-4/5 rounded bg-surface-deep/70" />
        <div className="h-4 w-3/5 rounded bg-surface-deep/70" />
        <div className="mt-3 h-3 w-1/3 rounded bg-surface-deep/50" />
      </div>
    </div>
  );
}
