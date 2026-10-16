import { useParams } from 'react-router';
import { NotFoundPanel } from '@/components/not-found-panel';
import { useDocument } from './presenters/use-document';
import { DocumentView } from './views/document-view';

/** /documents/:id: one document's details. */
export function DocumentPage() {
  const { id = '' } = useParams();
  const state = useDocument(id);

  if (state.status === 'not-found') {
    return (
      <NotFoundPanel
        title="Document not found"
        message="This document does not exist, or it is not shared with you."
        action={{ label: 'See all colleges', to: '/colleges' }}
      />
    );
  }
  return <DocumentView {...state} />;
}
