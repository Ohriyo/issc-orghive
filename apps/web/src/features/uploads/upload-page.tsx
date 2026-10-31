import { Navigate, useLocation, useParams } from 'react-router';
import { NotFoundPanel } from '@/components/not-found-panel';
import { RequireAuth } from '@/features/auth/auth-pages';
import { OrganizationNotFound } from '@/features/organizations/organization-page';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import type { Destination } from '@/navigation/origin';
import { useOrgPlace } from '@/navigation/use-places';
import {
  useUploadDocuments,
  useUploadProject,
  type UploadProject,
} from './presenters/use-upload-documents';
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

/** /projects/:id/files/upload: the organization's account adds a project's extra files (spec 2C). */
export function ProjectFilesUploadPage() {
  return (
    <RequireAuth>
      <ProjectFilesUploadContent />
    </RequireAuth>
  );
}

function ProjectFilesUploadContent() {
  const { id = '' } = useParams();
  const target = useUploadProject(id);
  const ready = target.status === 'ready' ? target : null;
  const page = chrome.projectFilesUpload(
    ready?.org ?? null,
    ready ? { id, name: ready.project.name } : null,
  );
  usePageChrome(page);
  if (target.status === 'not-found') {
    return (
      <NotFoundPanel
        title="Project not found"
        message="This project does not exist, or it belongs to another organization."
        action={{ label: 'Go to the dashboard', to: '/dashboard' }}
      />
    );
  }
  if (target.status !== 'ready') return <UploadView {...target} />;
  return <ProjectFilesUpload slug={target.org.slug} parent={page.parent} project={target.project} />;
}

function ProjectFilesUpload({
  slug,
  parent,
  project,
}: {
  slug: string;
  parent: Destination | null;
  project: UploadProject;
}) {
  const state = useUploadDocuments(slug, parent, project);
  if (state.status === 'not-found') return <OrganizationNotFound />;
  return <UploadView {...state} />;
}
