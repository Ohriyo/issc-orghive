import { OriginLink } from '@/navigation/origin-link';
import { Container } from '@/components/container';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import type { DocumentPageState } from '../presenters/use-document';
import type { DocumentFilesModel } from '../presenters/use-document-files';
import { DocumentFiles } from './document-files';

export type DocumentViewProps = Exclude<DocumentPageState, { status: 'not-found' }> & {
  files: DocumentFilesModel;
};

const STATUS_LABEL = {
  draft: 'Draft',
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  archived: 'Archived',
} as const;

const dateFormat = new Intl.DateTimeFormat('en-PH', { dateStyle: 'long' });

/**
 * /documents/:id: the document's details and its files (every version, downloadable once
 * clean; officers can upload a new version).
 */
export function DocumentView(props: DocumentViewProps) {
  return (
    <div className="bg-surface-sweep min-h-page">
      <title>
        {props.status === 'ready' ? `${props.page.title} | Orghive` : 'Document | Orghive'}
      </title>
      <Container as="main" className="max-w-4xl pt-4 pb-section lg:pt-6">
        {props.status === 'ready' ? (
          <>
            <article>
              <p className="inline-block rounded-full bg-ink px-3 py-1 text-small font-semibold text-white">
                {props.page.typeLabel}
              </p>
              <h1 className="mt-4 text-h1 font-bold text-pretty text-ink">{props.page.title}</h1>
              {props.page.description ? (
                <p className="mt-6 max-w-prose text-body-lg text-pretty text-ink">
                  {props.page.description}
                </p>
              ) : null}
              <dl className="mt-8 grid gap-x-8 gap-y-4 text-body sm:grid-cols-2">
                <div>
                  <dt className="text-small text-ink-muted">Organization</dt>
                  <dd>
                    <OriginLink
                      to={props.page.org.href}
                      className="tap-area font-medium text-ink underline decoration-1 underline-offset-4 hover:decoration-leaf focus-visible:decoration-leaf"
                    >
                      {props.page.org.name}
                    </OriginLink>
                  </dd>
                </div>
                <div>
                  <dt className="text-small text-ink-muted">Academic term</dt>
                  <dd className="text-ink">{props.page.term}</dd>
                </div>
                <div>
                  <dt className="text-small text-ink-muted">Date</dt>
                  <dd className="text-ink">
                    <time dateTime={props.page.date}>
                      {dateFormat.format(new Date(props.page.date))}
                    </time>
                  </dd>
                </div>
                <div>
                  <dt className="text-small text-ink-muted">Status</dt>
                  <dd className="text-ink">{STATUS_LABEL[props.page.status]}</dd>
                </div>
              </dl>
              <DocumentFiles files={props.files} />
            </article>
          </>
        ) : props.status === 'error' ? (
          <SectionError
            message="This document could not be loaded. Check your connection and try again."
            onRetry={props.retry}
          />
        ) : (
          <div aria-busy="true">
            <h1 className="sr-only">Loading the document</h1>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-12 h-7 w-32" />
            <Skeleton className="mt-4 h-12 w-full max-w-xl" />
            <Skeleton className="mt-6 h-24 w-full max-w-prose rounded-2xl" />
          </div>
        )}
      </Container>
    </div>
  );
}
