import { useHomeData } from './presenters/use-home-data';
import { HomeView } from './views/home-view';

/** Route component: connects the presenter to the view. */
export function HomePage() {
  const data = useHomeData();
  return <HomeView {...data} />;
}
