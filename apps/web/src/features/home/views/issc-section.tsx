import type { OrganizationDetail } from '@orghive/shared';
import { OriginLink } from '@/navigation/origin-link';
import { HexFrame } from '@/components/hex-frame';
import { OrgLogo } from '@/components/org-logo';
import { PillButton } from '@/components/pill-button';
import { Reveal } from '@/components/reveal';
import { WaveDivider } from '@/components/wave-divider';
import type { SectionState } from '../presenters/use-home-data';
import { Container } from '@/components/container';
import { LOGO_SIZES } from '@/components/logo-sizes';
import { SectionError } from '@/components/section-error';

export interface IsscSectionProps {
  issc: SectionState<OrganizationDetail | undefined>;
}

/** The ISSC card: name, description, quick links, and its logo in a large hexagon. */
export function IsscSection({ issc }: IsscSectionProps) {
  return (
    <section aria-labelledby="issc-heading" className="relative isolate overflow-hidden">
      <WaveDivider className="mb-6 lg:-mb-8" />

      <Container className="relative grid items-center gap-14 pb-section lg:grid-cols-2 lg:gap-8">
        {/* Below lg the logo leads and the text is centred under it. */}
        <Reveal className="relative z-10 max-lg:text-center">
          <IsscContent issc={issc} />
        </Reveal>

        <Reveal className="relative max-lg:order-first">
          {/* Decorative honeycomb neighbors, as in the prototype. */}
          <div aria-hidden="true" className="hidden lg:block">
            <HexFrame
              band={false}
              ring={false}
              shadow={false}
              className="absolute top-[-38%] right-[-46%] w-[52%] opacity-90"
            />
            <HexFrame
              band={false}
              ring={false}
              shadow={false}
              className="absolute right-[-46%] bottom-[-26%] w-[52%] opacity-90"
            />
          </div>
          <HexFrame
            band={false}
            ring={false}
            className="relative mx-auto w-full max-w-[14rem] sm:max-w-[20rem] lg:max-w-[36rem]"
          >
            {issc.data ? (
              <OrgLogo
                name={issc.data.name}
                src={issc.data.logoUrl ?? undefined}
                srcSet={issc.data.logoSrcSet ?? undefined}
                sizes={LOGO_SIZES.feature}
                fallbackText={issc.data.acronym}
                className="size-full"
              />
            ) : (
              <span aria-hidden="true" className="size-full" />
            )}
          </HexFrame>
        </Reveal>
      </Container>
    </section>
  );
}

function IsscContent({ issc }: IsscSectionProps) {
  if (issc.isError) {
    return (
      <>
        <h2 id="issc-heading" className="text-display font-bold whitespace-nowrap text-ink">
          NwSSU-ISSC
        </h2>
        <SectionError
          className="mt-6"
          message="The ISSC profile could not be loaded. Check your connection and try again."
          onRetry={issc.retry}
        />
      </>
    );
  }

  if (!issc.data) {
    return (
      <div aria-busy="true" className="space-y-4 max-lg:flex max-lg:flex-col max-lg:items-center">
        <h2 id="issc-heading" className="sr-only">
          Loading the ISSC profile
        </h2>
        <div className="h-14 w-72 animate-pulse rounded-full bg-surface-deep motion-reduce:animate-none" />
        <div className="h-5 w-80 max-w-full animate-pulse rounded-full bg-surface-deep motion-reduce:animate-none" />
        <div className="h-32 w-full max-w-md animate-pulse rounded-3xl bg-surface-deep motion-reduce:animate-none" />
      </div>
    );
  }

  const { slug, acronym, name, description } = issc.data;
  const links = [
    { label: 'Paperworks', to: `/orgs/${slug}/paperworks` },
    // The Collegiate Student Councils carousel.
    { label: 'CSC', to: '/colleges' },
    { label: 'Updates', to: `/orgs/${slug}/updates` },
  ];

  return (
    <>
      <h2 id="issc-heading" className="text-display font-bold text-ink">
        <span className="block whitespace-nowrap">NwSSU-{acronym}</span>{' '}
        <span className="mt-2 block text-lead font-normal tracking-normal">{name}</span>
      </h2>
      {description ? (
        <p className="mt-8 max-w-[30rem] text-body-lg text-pretty text-ink max-lg:mx-auto">
          {description}
        </p>
      ) : null}
      <nav aria-label={`${acronym} sections`} className="mt-10">
        <ul className="flex flex-wrap gap-4 max-lg:justify-center">
          {links.map((link) => (
            <li key={link.label}>
              <PillButton asChild size="lg">
                <OriginLink to={link.to}>{link.label}</OriginLink>
              </PillButton>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
