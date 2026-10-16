import { useParams } from 'react-router';
import { OrganizationNotFound } from '@/features/organizations/organization-page';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useOrgPlace } from '@/navigation/use-places';
import { usePaperworks } from './presenters/use-paperworks';
import { PaperworksView } from './views/paperworks-view';

/** /orgs/:slug/paperworks: an organization's document archive. */
export function PaperworksPage() {
  const { slug = '' } = useParams();
  const state = usePaperworks(slug);
  usePageChrome(chrome.paperworks(slug, useOrgPlace(slug)));

  if (state.status === 'not-found') return <OrganizationNotFound />;
  return <PaperworksView {...state} />;
}
