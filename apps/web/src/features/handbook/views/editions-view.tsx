import { Container } from '@/components/container';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { OriginLink } from '@/navigation/origin-link';
import type { EditionsModel } from '../presenters/use-handbook-editions';
import { HandbookCover } from './handbook-cover';

/** /handbook/editions: every edition of the Student Handbook, newest first. */
export function EditionsView({ model }: { model: EditionsModel }) {
  return (
    <div className="bg-surface-sweep min-h-page">
      <title>Student Handbook editions | Orghive</title>
      <Container as="main" className="pt-4 pb-section lg:pt-6">
        <header className="mt-8 max-w-prose">
          <h1 className="text-h1 font-bold text-balance text-ink">Student Handbook editions</h1>
          <p className="mt-3 text-body-lg text-pretty text-ink">
            Every edition the ISSC has published here, one per academic year. Each opens view
            only.
          </p>
        </header>
        {model.status === 'ready' ? (
          model.editions.length === 0 ? (
            <p className="mt-10 max-w-prose text-body-lg text-ink">
              No edition has been published yet.
            </p>
          ) : (
            <ol className="mt-10 grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {model.editions.map((edition) => (
                <li key={edition.academicYear}>
                  <OriginLink
                    to={edition.href}
                    className="group flex flex-col gap-3 rounded-2xl outline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"
                  >
                    <HandbookCover src={edition.coverUrl} yearLabel={edition.yearLabel} interactive />
                    <span>
                      <span className="block text-body-lg font-semibold text-ink underline decoration-transparent decoration-1 underline-offset-4 transition-colors duration-300 group-hover:decoration-leaf group-focus-visible:decoration-leaf">
                        {edition.yearLabel}
                      </span>
                      <span className="block text-small text-ink-muted">
                        {edition.isCurrent ? 'Current edition' : 'Past edition'}
                        {edition.pageCount ? `, ${edition.pageCount} pages` : ''}
                      </span>
                    </span>
                  </OriginLink>
                </li>
              ))}
            </ol>
          )
        ) : model.status === 'error' ? (
          <SectionError
            className="mt-10"
            message="The editions could not be loaded. Check your connection and try again."
            onRetry={model.retry}
          />
        ) : (
          <div aria-busy="true" className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
            <span className="sr-only">Loading the editions</span>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="aspect-[1/1.3] rounded-[3px]" />
            ))}
          </div>
        )}
      </Container>
    </div>
  );
}
