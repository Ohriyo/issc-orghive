import { siteSeo } from '@orghive/shared';
import { Seo } from '@/components/seo';
import type { HomeData } from '../presenters/use-home-data';
import { AboutSection } from './about-section';
import { ContactFooter } from './contact-footer';
import { HeroSection } from './hero-section';
import { IsscSection } from './issc-section';
import { SiteHeader } from './site-header';

export type HomeViewProps = HomeData;

export function HomeView({ colleges, issc }: HomeViewProps) {
  return (
    <div className="bg-surface-sweep relative min-h-dvh overflow-x-clip">
      <Seo seo={siteSeo()} />
      <SiteHeader />
      <main>
        <HeroSection colleges={colleges} />
        <AboutSection />
        <IsscSection issc={issc} />
      </main>
      <ContactFooter />
    </div>
  );
}
