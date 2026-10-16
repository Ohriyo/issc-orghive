import { useAccountLink } from '@/features/auth/presenters/use-auth';
import { useDocumentSearch } from '@/features/search/presenters/use-document-search';
import { useHomeData } from './presenters/use-home-data';
import { HomeView } from './views/home-view';

/** Route component: connects the presenter to the view. */
export function HomePage() {
  const data = useHomeData();
  const search = useDocumentSearch();
  const account = useAccountLink();
  return <HomeView {...data} search={search} account={account} />;
}
