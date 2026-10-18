import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useSearchPage } from './presenters/use-search-page';
import { SearchPageView } from './views/search-page-view';

/** /search: full-text search of every Paperworks document the viewer may see, with filters. */
export function SearchPage() {
  const state = useSearchPage();
  usePageChrome(chrome.search());
  return <SearchPageView {...state} />;
}
