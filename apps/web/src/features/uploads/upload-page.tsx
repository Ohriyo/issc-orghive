import { useParams } from 'react-router';
import { RequireAuth } from '@/features/auth/auth-pages';
import { OrganizationNotFound } from '@/features/organizations/organization-page';
import { useUploadDocuments } from './presenters/use-upload-documents';
import { UploadView } from './views/upload-view';

/** /orgs/:slug/paperworks/upload: officers add documents to their organization. */
export function UploadPage() {
  return (
    <RequireAuth>
      <UploadContent />
    </RequireAuth>
  );
}

function UploadContent() {
  const { slug = '' } = useParams();
  const state = useUploadDocuments(slug);
  if (state.status === 'not-found') return <OrganizationNotFound />;
  return <UploadView {...state} />;
}
