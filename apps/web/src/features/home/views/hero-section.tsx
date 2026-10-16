import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { Container } from '@/components/container';
import { HexGrid, type HexGridCell } from '@/components/hex-grid';
import { PillButton } from '@/components/pill-button';
import { Reveal } from '@/components/reveal';
import type { SectionState } from '../presenters/use-home-data';
import { HeroBackground } from './hero-background';
import { SectionError } from '@/components/section-error';

export interface HeroSectionProps {
  colleges: SectionState<HexGridCell[]>;
}

/**
 * Tagline and call to action on the left; the honeycomb of colleges on the right,
 * bleeding off the top and right edges on wide screens as in the prototype.
 */
export function HeroSection({ colleges }: HeroSectionProps) {
  return (
    <section
      aria-labelledby="hero-heading"
      className="relative isolate lg:min-h-[calc(min(68vw,58rem)*0.86)]"
    >
      <HeroBackground />

      <Container className="relative pt-32 pb-section lg:pt-[min(23vw,20rem)]">
        <Reveal className="max-w-md lg:max-w-[min(36vw,30rem)]">
          <h1 id="hero-heading" className="text-h2 font-normal text-ink">
            Organizing Unity, Archiving Transparency
          </h1>
          <div className="mt-10 flex items-center gap-4 lg:mt-20">
            <PillButton asChild size="lg">
              <Link to="/browse" className="underline decoration-1 underline-offset-4">
                Browse Repository
              </Link>
            </PillButton>
            <ArrowRight aria-hidden="true" className="size-7 shrink-0 text-ink" />
          </div>
        </Reveal>

        <div className="mt-14 lg:absolute lg:top-[calc(min(68vw,58rem)*-0.133)] lg:left-[calc(50%-7rem)] lg:mt-0 lg:w-[min(68vw,58rem)]">
          <HexGrid
            label="Colleges"
            cells={colleges.data}
            columns={4}
            mobileColumns={2}
            isLoading={colleges.isLoading}
            skeletonCount={8}
            emptyState={
              <p className="text-body text-ink-muted">
                No colleges have been added yet. They will appear here once an admin adds them.
              </p>
            }
            error={
              colleges.isError ? (
                <SectionError
                  message="The colleges could not be loaded. Check your connection and try again."
                  onRetry={colleges.retry}
                  className="lg:mt-[min(30vw,24rem)] lg:pl-24"
                />
              ) : undefined
            }
          />
        </div>
      </Container>
    </section>
  );
}
