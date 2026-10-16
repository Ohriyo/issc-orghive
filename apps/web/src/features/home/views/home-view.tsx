import { siteSeo } from '@orghive/shared';
import { Seo } from '@/components/seo';
import type { AccountLink } from '@/features/auth/presenters/use-auth';
import type { DocumentSearchModel } from '@/features/search/presenters/use-document-search';
import type { HomeData } from '../presenters/use-home-data';
import { AboutSection } from './about-section';
import { ContactFooter } from './contact-footer';
import { HeroSection } from './hero-section';
import { IsscSection } from './issc-section';
import { SiteHeader } from './site-header';

export type HomeViewProps = HomeData & {
  search: DocumentSearchModel;
  account: AccountLink;
};

export function HomeView({ colleges, issc, search, account }: HomeViewProps) {
  return (
    <div className="bg-surface-sweep relative min-h-dvh overflow-x-clip">
      <Seo seo={siteSeo()} />
      <SiteHeader search={search} account={account} />
      <main>
        <HeroSection colleges={colleges} />
        <AboutSection />
        <IsscSection issc={issc} />
      </main>
      <ContactFooter />
    </div>
  );
}
