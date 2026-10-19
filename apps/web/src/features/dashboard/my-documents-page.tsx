import { RequireAuth } from '@/features/auth/auth-pages';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useMyDocuments } from './presenters/use-my-documents';
import { MyDocumentsView } from './views/my-documents-view';

/** /dashboard/documents?org=&status=&q= */
export function MyDocumentsPage() {
  return (
    <RequireAuth>
      <MyDocumentsContent />
    </RequireAuth>
  );
}

function MyDocumentsContent() {
  const model = useMyDocuments();
  usePageChrome(
    chrome.workspace(model.status === 'ready' ? `${model.org.acronym} documents` : 'My documents'),
  );
  return <MyDocumentsView model={model} />;
}
