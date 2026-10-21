import { useParams, useSearchParams } from 'react-router';
import { NotFoundPanel } from '@/components/not-found-panel';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useOrgPlace } from '@/navigation/use-places';
import { useDocument } from './presenters/use-document';
import { useDocumentFiles } from './presenters/use-document-files';
import { useDocumentPages } from './presenters/use-document-pages';
import { DocumentView } from './views/document-view';

/** /documents/:id: one document's details. */
export function DocumentPage() {
  const { id = '' } = useParams();
  // ?version=: an earlier version (any version of a Constitution & By-laws is public).
  const versionId = useSearchParams()[0].get('version') ?? undefined;
  const state = useDocument(id);
  const ready = state.status === 'ready' ? state.page : undefined;
  const files = useDocumentFiles(id, ready?.org, !ready?.isConstitution);
  const pages = useDocumentPages(id, versionId);
  const org = useOrgPlace(state.status === 'ready' ? state.page.org.slug : undefined);
  usePageChrome(chrome.document(org, state.status === 'ready' ? state.page.title : null));

  if (state.status === 'not-found') {
    return (
      <NotFoundPanel
        title="Document not found"
        message="This document does not exist, or it is not shared with you."
        action={{ label: 'See all colleges', to: '/colleges' }}
      />
    );
  }
  return <DocumentView {...state} files={files} pages={pages} earlierVersion={!!versionId} />;
}
