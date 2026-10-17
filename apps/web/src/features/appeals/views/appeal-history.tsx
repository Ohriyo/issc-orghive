import { Skeleton } from '@/components/skeleton';
import { SectionError } from '@/components/section-error';
import type { ProjectAppealsModel } from '../presenters/use-compliance';
import { AppealDetails, AppealStatusChip } from './appeal-parts';

/** The project page's appeal history, newest first. Hidden when there has been none. */
export function AppealHistory({
  model,
  onOpenAttachment,
}: {
  model: ProjectAppealsModel;
  onOpenAttachment: (appealId: string, attachmentId: string) => void;
}) {
  if (model.status === 'ready' && model.items.length === 0) return null;
  return (
    <section aria-labelledby="appeal-history" className="mt-12">
      <h2 id="appeal-history" className="text-h2 font-bold text-ink">
        Appeals
      </h2>
      {model.status === 'loading' ? (
        <div aria-busy="true" className="mt-4">
          <span className="sr-only">Loading the appeals</span>
          <Skeleton className="h-32 w-full rounded-2xl" />
        </div>
      ) : model.status === 'error' ? (
        <SectionError
          className="mt-4"
          message="The appeal history could not be loaded."
          onRetry={model.retry}
        />
      ) : (
        <ol className="mt-4 flex flex-col gap-4">
          {model.items.map((appeal) => (
            <li
              key={appeal.id}
              className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-pool ring-1 ring-ink/10 md:p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-body-lg font-semibold text-ink">
                  {appeal.typeLabel}
                  <span className="font-normal text-ink-muted"> to {appeal.deciderAcronym}</span>
                </h3>
                <AppealStatusChip status={appeal.status} label={appeal.statusLabel} />
              </div>
              <AppealDetails
                appeal={appeal}
                onOpenAttachment={(attachmentId) => onOpenAttachment(appeal.id, attachmentId)}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
