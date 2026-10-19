import { Lock, Snowflake } from 'lucide-react';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { cn } from '@/lib/utils';
import { OriginLink } from '@/navigation/origin-link';
import type { ComplianceNotice } from '../presenters/appeal-format';
import type { ComplianceModel } from '../presenters/use-compliance';

export interface ComplianceBannerProps {
  model: ComplianceModel | null;
  /** On a project page: only that project's block or freeze. */
  projectId?: string;
  /** The dashboard links each notice to its project; the project page does not. */
  showProjectLink?: boolean;
  className?: string;
}

/**
 * The banners for a blocked project or a frozen organization (spec section 3): what went
 * wrong, the last rejection's remarks, a pending appeal, and "Submit appeal" for officers.
 * Nothing while loading or when everything is in order.
 */
export function ComplianceBanner({
  model,
  projectId,
  showProjectLink = false,
  className,
}: ComplianceBannerProps) {
  if (!model || model.status === 'loading') return null;
  if (model.status === 'error') {
    return (
      <SectionError
        className={className}
        message="Deadlines and appeals could not be checked. Try again."
        onRetry={model.retry}
      />
    );
  }
  const notices = projectId
    ? model.notices.filter((n) => n.projectId === projectId)
    : model.notices;
  if (notices.length === 0) return null;
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {notices.map((notice) => (
        <Notice
          key={`${notice.kind}-${notice.id}`}
          notice={notice}
          showProjectLink={showProjectLink}
        />
      ))}
    </div>
  );
}

function Notice({
  notice,
  showProjectLink,
}: {
  notice: ComplianceNotice;
  showProjectLink: boolean;
}) {
  const frozen = notice.kind === 'frozen';
  const Icon = frozen ? Snowflake : Lock;
  const title = frozen ? 'Your organization is frozen' : `${notice.projectName} is blocked`;
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-4 rounded-2xl bg-destructive/10 p-4 ring-1 ring-destructive/25 md:flex-row md:items-start md:gap-6 md:p-5"
    >
      <Icon aria-hidden="true" className="size-6 shrink-0 text-destructive" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 className="text-body-lg font-semibold text-ink">{title}</h2>
        <p className="text-body text-pretty text-ink">{notice.message}</p>
        {notice.rejection ? (
          <p className="rounded-xl bg-white/70 p-3 text-body break-words text-ink">
            <span className="font-semibold">
              Your last appeal was rejected on {notice.rejection.date}.
            </span>{' '}
            Remarks: {notice.rejection.remarks}
          </p>
        ) : null}
        {notice.pending ? (
          <p role="status" className="text-body font-medium text-ink">
            {notice.pending}
          </p>
        ) : null}
      </div>
      {notice.appealHref || showProjectLink ? (
        <div className="flex shrink-0 flex-col gap-2 max-md:w-full sm:flex-row md:flex-col">
          {notice.appealHref ? (
            <PillButton asChild size="md" className="max-sm:w-full">
              <OriginLink to={notice.appealHref}>
                {notice.rejection ? 'Appeal again' : 'Submit appeal'}
              </OriginLink>
            </PillButton>
          ) : null}
          {showProjectLink ? (
            <PillButton asChild variant="light" size="md" className="max-sm:w-full">
              <OriginLink to={notice.projectHref}>
                Open project<span className="sr-only">: {notice.projectName}</span>
              </OriginLink>
            </PillButton>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
