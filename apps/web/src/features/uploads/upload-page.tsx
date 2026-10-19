import { Navigate, useLocation, useParams } from 'react-router';
import { RequireAuth } from '@/features/auth/auth-pages';
import { OrganizationNotFound } from '@/features/organizations/organization-page';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useOrgPlace } from '@/navigation/use-places';
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
  const org = useOrgPlace(slug);
  const page = chrome.workspace('Upload', org ?? { slug, acronym: slug.toUpperCase() });
  usePageChrome(page);
  const state = useUploadDocuments(slug, page.parent);
  if (state.status === 'not-found') return <OrganizationNotFound />;
  return <UploadView {...state} />;
}

/** /orgs/:slug/upload: a short alias. Keeps the origin, so Back still returns there. */
export function UploadAliasRedirect() {
  const { slug = '' } = useParams();
  const location = useLocation();
  return (
    <Navigate to={`/orgs/${slug}/paperworks/upload`} replace state={location.state as unknown} />
  );
}
