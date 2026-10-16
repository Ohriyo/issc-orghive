import { siteSeo } from '@orghive/shared';
import { Seo } from '@/components/seo';
import type { HomeData } from '../presenters/use-home-data';
import { AboutSection } from './about-section';
import { ContactFooter } from './contact-footer';
import { HeroSection } from './hero-section';
import { IsscSection } from './issc-section';
export type HomeViewProps = HomeData;

/** The header comes from AppShell and floats over the hero (PageChrome overlay). */
export function HomeView({ colleges, issc }: HomeViewProps) {
  return (
    <div className="bg-surface-sweep relative min-h-dvh overflow-x-clip">
      <Seo seo={siteSeo()} />
      <main>
        <HeroSection colleges={colleges} />
        <AboutSection />
        <IsscSection issc={issc} />
      </main>
      <ContactFooter />
    </div>
  );
}
