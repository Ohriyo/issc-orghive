import { Link } from 'react-router';
import { Container } from '@/components/container';
import { LOGO_SIZES } from '@/components/logo-sizes';
import { EmphasizedText } from '@/components/emphasized-text';
import { HexFrame } from '@/components/hex-frame';
import { OrgLogo } from '@/components/org-logo';
import { PillButton } from '@/components/pill-button';
import { Reveal } from '@/components/reveal';
import { SectionError } from '@/components/section-error';
import { Seo } from '@/components/seo';
import { Skeleton } from '@/components/skeleton';
import { WaveDivider } from '@/components/wave-divider';
import type {
  OrganizationPageModel,
  OrganizationPageState,
} from '../presenters/use-organization-page';

export type OrganizationViewProps = Exclude<OrganizationPageState, { status: 'not-found' }>;

const HEX = 'mx-auto w-full max-w-[18rem] sm:max-w-[24rem] lg:max-w-[35rem]';
const ACRONYM = 'text-display font-bold text-ink';

/**
 * /orgs/:slug, from design/sbo-jpice.png (and jiiee, uapsa): the organization's logo in a
 * large framed hexagon, then its acronym, full name, description and Paperworks pill. The
 * prototype's wave bands frame the page top and bottom; they settle in once on arrival.
 */
export function OrganizationView(props: OrganizationViewProps) {
  return (
    <div className="bg-surface-sweep relative isolate flex min-h-dvh flex-col overflow-hidden">
      {props.status === 'ready' ? (
        <Seo seo={props.page.seo} />
      ) : (
        <title>Organization | Orghive</title>
      )}
      <WaveDivider className="pointer-events-none absolute inset-x-0 top-0 -z-10 -translate-y-[38%]" />
      <WaveDivider className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 translate-y-[48%] rotate-180" />

      <Container
        as="main"
        className="grid flex-1 content-center items-center gap-10 pt-[calc(14vw+2rem)] pb-[calc(11vw+3rem)] lg:grid-cols-2 lg:gap-16"
      >
        {props.status === 'ready' ? (
          <OrganizationProfile page={props.page} />
        ) : props.status === 'error' ? (
          <div className="lg:col-start-2">
            <h1 className={ACRONYM}>Organization</h1>
            <SectionError
              className="mt-8"
              message="This organization could not be loaded. Check your connection and try again."
              onRetry={props.retry}
            />
          </div>
        ) : (
          <ProfileSkeleton />
        )}
      </Container>
    </div>
  );
}

function OrganizationProfile({ page }: { page: OrganizationPageModel }) {
  return (
    <>
      <Reveal className="lg:order-last">
        <h1 className={ACRONYM}>
          <span className="block">{page.acronym}</span>{' '}
          <span className="mt-3 block max-w-[30rem] text-lead font-normal tracking-normal text-pretty">
            {page.name}
          </span>
        </h1>
        {page.description ? (
          <p className="mt-8 max-w-[30rem] text-body-lg text-pretty text-ink">
            <EmphasizedText segments={page.description} />
          </p>
        ) : null}
        <PillButton asChild size="lg" className="mt-10">
          <Link to={page.paperworksHref}>Paperworks</Link>
        </PillButton>
        {page.context ? (
          <p className="mt-10 max-w-[30rem] text-body text-ink">
            {page.context.lead}{' '}
            <Link
              to={page.context.college.href}
              className="font-medium underline decoration-1 underline-offset-4 transition-colors duration-300 tap-area hover:decoration-leaf focus-visible:decoration-leaf"
            >
              {page.context.college.name}
            </Link>
          </p>
        ) : null}
      </Reveal>
      <Reveal>
        <HexFrame className={HEX}>
          <OrgLogo
            name={page.name}
            src={page.logoSrc}
            srcSet={page.logoSrcSet}
            sizes={LOGO_SIZES.feature}
            alt=""
            fallbackText={page.acronym}
            priority
            className="size-full"
          />
        </HexFrame>
      </Reveal>
    </>
  );
}

function ProfileSkeleton() {
  return (
    <>
      <div aria-busy="true" className="lg:order-last">
        <h1 className="sr-only">Loading the organization</h1>
        <Skeleton className="h-12 w-48 lg:h-[4.5rem] lg:w-64" />
        <Skeleton className="mt-4 h-5 w-80 max-w-full" />
        <Skeleton className="mt-2 h-5 w-56 max-w-full" />
        <div className="mt-8 max-w-[30rem] space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-[94%]" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-[70%]" />
        </div>
        <Skeleton className="mt-10 h-14 w-44" />
      </div>
      <HexFrame
        shadow={false}
        className={`${HEX} animate-pulse opacity-70 motion-reduce:animate-none`}
      />
    </>
  );
}
