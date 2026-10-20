import { siteSeo } from '@orghive/shared';
import { Seo } from '@/components/seo';
import type { HomeLeaderboardModel } from '@/features/leaderboard/presenters/use-leaderboard-views';
import type { HomeData } from '../presenters/use-home-data';
import { AboutSection } from './about-section';
import { ContactFooter } from './contact-footer';
import { HeroSection } from './hero-section';
import { IsscSection } from './issc-section';
import { LeaderboardBand } from './leaderboard-band';

export type HomeViewProps = HomeData & { leaderboard: HomeLeaderboardModel };

/** The header comes from AppShell and floats over the hero (PageChrome overlay). */
export function HomeView({ colleges, issc, leaderboard }: HomeViewProps) {
  return (
    <div className="bg-surface-sweep relative min-h-dvh overflow-x-clip">
      <Seo seo={siteSeo()} />
      <main>
        <HeroSection colleges={colleges} />
        <LeaderboardBand model={leaderboard} />
        <AboutSection />
        <IsscSection issc={issc} />
      </main>
      <ContactFooter />
    </div>
  );
}
