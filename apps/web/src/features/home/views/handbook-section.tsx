import { ArrowRight } from 'lucide-react';
import { PillButton } from '@/components/pill-button';
import { Reveal } from '@/components/reveal';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import type { HandbookCardModel } from '@/features/handbook/presenters/use-handbook-editions';
import { HandbookCover } from '@/features/handbook/views/handbook-cover';
import { OriginLink } from '@/navigation/origin-link';

/**
 * Between About Us and the ISSC: the current Student Handbook as one card, its cover
 * standing like a book beside the year and the way in. The pill with the arrow beside it
 * follows the hero's "Browse Repository" (design/home.png).
 */
export function HandbookSection({ model }: { model: HandbookCardModel }) {
  return (
    <section aria-labelledby="handbook-heading" className="relative px-4 pb-20 sm:px-8 lg:pb-28">
      <Reveal className="mx-auto max-w-3xl">
        <h2 id="handbook-heading" className="text-center text-display font-bold text-ink">
          Student Handbook
        </h2>
        <div className="mt-10 rounded-[2rem] bg-white p-6 shadow-pool ring-1 ring-ink/10 sm:p-8 lg:mt-14">
          {model.status === 'ready' ? (
            <div className="flex flex-col items-center gap-8 text-center sm:flex-row sm:items-center sm:gap-10 sm:text-left">
              <OriginLink
                to={model.edition.href}
                tabIndex={-1}
                aria-hidden="true"
                className="group w-36 shrink-0 sm:w-44"
              >
                <HandbookCover
                  src={model.edition.coverUrl}
                  yearLabel={model.edition.yearLabel}
                  interactive
                />
              </OriginLink>
              <div className="min-w-0">
                <p className="text-h2 font-bold text-ink">{model.edition.yearLabel}</p>
                <p className="mt-1 text-body text-ink-muted">
                  Current edition{model.edition.pageCount ? `, ${model.edition.pageCount} pages` : ''}
                </p>
                <p className="mt-4 max-w-[40ch] text-body-lg text-pretty text-ink">
                  Read it page by page, or search it for any rule or policy.
                </p>
                <div className="mt-6 flex items-center justify-center gap-4 sm:justify-start">
                  <PillButton asChild size="lg">
                    <OriginLink to={model.edition.href}>Read the Handbook</OriginLink>
                  </PillButton>
                  <ArrowRight aria-hidden="true" className="size-7 shrink-0 text-ink" />
                </div>
              </div>
            </div>
          ) : model.status === 'none' ? (
            <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:gap-10 sm:text-left">
              <HandbookCover src={null} yearLabel="Coming soon" className="w-28 shrink-0 opacity-70" />
              <p className="max-w-[40ch] text-body-lg text-pretty text-ink">
                This year&apos;s Student Handbook has not been published yet. The ISSC posts each
                edition here when it takes effect.
              </p>
            </div>
          ) : model.status === 'error' ? (
            <SectionError
              message="The Student Handbook could not be loaded. Check your connection and try again."
              onRetry={model.retry}
            />
          ) : (
            <div aria-busy="true" className="flex flex-col items-center gap-8 sm:flex-row">
              <span className="sr-only">Loading the Student Handbook</span>
              <Skeleton className="aspect-[1/1.3] w-36 shrink-0 rounded-r-[4px] sm:w-44" />
              <div className="w-full max-w-sm">
                <Skeleton className="h-9 w-40" />
                <Skeleton className="mt-3 h-5 w-48" />
                <Skeleton className="mt-6 h-14 w-56" />
              </div>
            </div>
          )}
        </div>
      </Reveal>
    </section>
  );
}
