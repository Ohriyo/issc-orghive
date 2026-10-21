import { OriginLink } from '@/navigation/origin-link';
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
import type { ConstitutionModel } from '../presenters/use-constitution';
import type {
  OrganizationPageModel,
  OrganizationPageState,
} from '../presenters/use-organization-page';
import { OrganizationRecord } from './organization-record';

export type OrganizationViewProps = Exclude<OrganizationPageState, { status: 'not-found' }> & {
  constitution: ConstitutionModel;
};

const HEX = 'mx-auto w-full max-w-[14rem] sm:max-w-[20rem] lg:max-w-[35rem]';
/** Below lg the logo leads and the text is centred under it. */
const TEXT_COLUMN = 'order-last max-lg:text-center';
const ACRONYM = 'text-display font-bold text-ink';

/**
 * /orgs/:slug, from design/sbo-jpice.png (and jiiee, uapsa): the organization's logo in a
 * large framed hexagon, then its acronym, full name, description and Paperworks pill.
 * Side by side from lg; below it the logo sits on top and the text is centred. The
 * prototype's wave bands frame the hero top and bottom; they settle in once on arrival.
 * Below the hero, the organization's own profile (organization-record.tsx).
 */
export function OrganizationView(props: OrganizationViewProps) {
  return (
    <div className="bg-surface-sweep">
      {props.status === 'ready' ? (
        <Seo seo={props.page.seo} />
      ) : (
        <title>Organization | Orghive</title>
      )}
      <OrganizationHero {...props} />
      {props.status === 'ready' ? (
        <OrganizationRecord page={props.page} constitution={props.constitution} />
      ) : null}
    </div>
  );
}

/** The prototype's hero. `preview` (the profile editor) skips the arrival motion and LCP hints. */
export function OrganizationHero(props: OrganizationViewProps & { preview?: boolean }) {
  return (
    <div className="relative isolate flex min-h-page flex-col overflow-hidden">
      <WaveDivider className="pointer-events-none absolute inset-x-0 top-0 -z-10 -translate-y-[38%]" />
      <WaveDivider className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 translate-y-[48%] rotate-180" />

      <Container
        as="main"
        className="grid flex-1 content-center items-center gap-10 pt-[calc(14vw+2rem)] pb-[calc(11vw+3rem)] lg:grid-cols-2 lg:gap-16"
      >
        {props.status === 'ready' ? (
          <OrganizationProfile page={props.page} preview={props.preview} />
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

function OrganizationProfile({ page, preview }: { page: OrganizationPageModel; preview?: boolean }) {
  const Block = preview ? 'div' : Reveal;
  return (
    <>
      <Block className={TEXT_COLUMN}>
        <h1 className={ACRONYM}>
          <span className="block">{page.acronym}</span>{' '}
          <span className="mt-3 block max-w-[30rem] text-lead font-normal tracking-normal text-pretty max-lg:mx-auto">
            {page.name}
          </span>
        </h1>
        {page.description ? (
          <p className="mt-8 max-w-[30rem] text-body-lg text-pretty text-ink max-lg:mx-auto">
            <EmphasizedText segments={page.description} />
          </p>
        ) : null}
        <PillButton asChild size="lg" className="mt-10">
          <OriginLink to={page.paperworksHref}>Paperworks</OriginLink>
        </PillButton>
        {page.context ? (
          <p className="mt-10 max-w-[30rem] text-body text-ink max-lg:mx-auto">
            {page.context.lead}{' '}
            <OriginLink
              to={page.context.college.href}
              className="font-medium underline decoration-1 underline-offset-4 transition-colors duration-300 tap-area hover:decoration-leaf focus-visible:decoration-leaf"
            >
              {page.context.college.name}
            </OriginLink>
          </p>
        ) : null}
      </Block>
      <Block>
        <HexFrame className={HEX}>
          <OrgLogo
            name={page.name}
            src={page.logoSrc}
            srcSet={page.logoSrcSet}
            sizes={LOGO_SIZES.feature}
            alt=""
            fallbackText={page.acronym}
            priority={!preview}
            className="size-full"
          />
        </HexFrame>
      </Block>
    </>
  );
}

function ProfileSkeleton() {
  return (
    <>
      <div
        aria-busy="true"
        className={`${TEXT_COLUMN} max-lg:flex max-lg:flex-col max-lg:items-center`}
      >
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
