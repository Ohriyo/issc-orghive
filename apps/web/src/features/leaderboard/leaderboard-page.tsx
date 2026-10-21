import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useLeaderboardPage } from './presenters/use-leaderboard-views';
import { LeaderboardView } from './views/leaderboard-view';

/** Route component: /leaderboard. */
export function LeaderboardPage() {
  const model = useLeaderboardPage();
  usePageChrome(chrome.leaderboard());
  return <LeaderboardView model={model} />;
}
