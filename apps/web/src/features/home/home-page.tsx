import { useHomeLeaderboard } from '@/features/leaderboard/presenters/use-leaderboard-views';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useHomeData } from './presenters/use-home-data';
import { HomeView } from './views/home-view';

/** Route component: connects the presenter to the view. */
export function HomePage() {
  const data = useHomeData();
  const leaderboard = useHomeLeaderboard();
  usePageChrome(chrome.home());
  return <HomeView {...data} leaderboard={leaderboard} />;
}
