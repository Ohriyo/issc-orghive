import { Navigate, useLocation, useParams } from 'react-router';
import { NotFoundPanel } from '@/components/not-found-panel';
import { useOrganizationPage } from './presenters/use-organization-page';
import { OrganizationView } from './views/organization-view';

/** /orgs/:slug: an organization's profile and the way into its Paperworks. */
export function OrganizationPage() {
  const { slug = '' } = useParams();
  const state = useOrganizationPage(slug);

  if (state.status === 'not-found') return <OrganizationNotFound />;
  return <OrganizationView {...state} />;
}

export function OrganizationNotFound() {
  return (
    <NotFoundPanel
      title="Organization not found"
      message="There is no organization at this address. Find it through its college instead."
      action={{ label: 'See all colleges', to: '/colleges' }}
    />
  );
}

/** Old /organizations/:slug/* links (shared before the move to /orgs) keep working. */
export function LegacyOrganizationRedirect() {
  const { slug = '', '*': rest = '' } = useParams();
  const { search, hash } = useLocation();
  return <Navigate to={`/orgs/${slug}${rest ? `/${rest}` : ''}${search}${hash}`} replace />;
}
