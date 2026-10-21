import { Link, useLocation } from 'react-router';
import { OriginLink } from '@/navigation/origin-link';
import { Container } from '@/components/container';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { STATUS_STYLE } from '@/components/status-style';
import { VISIBILITY_LABEL } from '@/components/visibility';
import { VisibilitySelect } from '@/components/visibility-select';
import type { DocumentPageState } from '../presenters/use-document';
import type { DocumentFilesModel } from '../presenters/use-document-files';
import type { DocumentPagesModel } from '../presenters/use-document-pages';
import { DocumentFiles } from './document-files';
import { PageViewer } from './page-viewer';

export type DocumentViewProps = Exclude<DocumentPageState, { status: 'not-found' }> & {
  files: DocumentFilesModel;
  pages: DocumentPagesModel;
  /** The viewer shows an earlier version (?version=), not the current one. */
  earlierVersion?: boolean;
};

const LINK =
  'tap-area font-medium text-ink underline decoration-1 underline-offset-4 hover:decoration-leaf focus-visible:decoration-leaf';

const dateFormat = new Intl.DateTimeFormat('en-PH', { dateStyle: 'long' });

/**
 * /documents/:id: the document's details, its view-only preview, and its files (the owning
 * organization downloads the originals and uploads new versions).
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
                  <dd className="text-ink">{STATUS_STYLE[props.page.status].label}</dd>
                </div>
                {props.visibility.canChange ? null : (
                  <div>
                    <dt className="text-small text-ink-muted">Who can see it</dt>
                    <dd className="text-ink">
                      {props.page.isConstitution
                        ? 'Everyone, always (view only)'
                        : VISIBILITY_LABEL[props.page.visibility]}
                    </dd>
                  </div>
                )}
              </dl>
              {props.visibility.canChange ? (
                <VisibilitySelect
                  className="mt-6 max-w-sm"
                  value={props.page.visibility}
                  disabled={props.visibility.saving}
                  error={props.visibility.error}
                  onChange={props.visibility.change}
                />
              ) : null}
              {props.earlierVersion ? (
                <p
                  role="status"
                  className="mt-8 rounded-2xl bg-caution-surface px-5 py-4 text-body text-caution"
                >
                  You are viewing an earlier version.{' '}
                  <CurrentVersionLink documentId={props.page.id} />
                </p>
              ) : null}
              <PageViewer
                pages={props.pages}
                isOwner={props.files.canDownload}
                title={props.page.title}
              />
              <DocumentFiles files={props.files} />
              {props.page.isConstitution && props.files.canDownload ? (
                <p className="mt-6 max-w-prose text-body text-ink-muted">
                  To amend it, upload the new text from{' '}
                  <OriginLink to="/dashboard/profile#constitution" className={LINK}>
                    your organization profile
                  </OriginLink>
                  , with what changed and the date it was amended.
                </p>
              ) : null}
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

/** Back to the current version in place, keeping where the reader came from (for Back). */
function CurrentVersionLink({ documentId }: { documentId: string }) {
  const location = useLocation();
  return (
    <Link to={`/documents/${documentId}`} replace state={location.state as unknown} className={LINK}>
      View the current version
    </Link>
  );
}
