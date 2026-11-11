import { OriginLink } from '@/navigation/origin-link';
import { Container } from '@/components/container';
import { HEX_CLIP } from '@/components/hex-geometry';
import { LOGO_SIZES } from '@/components/logo-sizes';
import { HexFrame } from '@/components/hex-frame';
import { OrgLogo } from '@/components/org-logo';
import { SampleDataChip } from '@/components/sample-data-chip';
import { Reveal } from '@/components/reveal';
import { SectionError } from '@/components/section-error';
import { Seo } from '@/components/seo';
import { Skeleton } from '@/components/skeleton';
import { WaveDivider } from '@/components/wave-divider';
import type { OrgPostSectionsState } from '@/features/posts/presenters/use-org-post-sections';
import type { ConstitutionModel } from '../presenters/use-constitution';
import type { OrgShowcaseState, RankBadgeModel } from '../presenters/use-org-showcase';
import type {
  OrganizationPageModel,
  OrganizationPageState,
} from '../presenters/use-organization-page';
import { SocialLinks } from './org-page-sections';
import { OrganizationRecord } from './organization-record';

export type OrganizationViewProps = Exclude<OrganizationPageState, { status: 'not-found' }> & {
  constitution: ConstitutionModel;
  /** Highlights and updates (features/posts); the profile editor's preview has none. */
  posts?: OrgPostSectionsState;
  /** Rank badge, completed projects and public documents; the preview has none. */
  showcase?: OrgShowcaseState;
};

const HEX = 'w-36 shrink-0 sm:w-44 lg:w-56';
const LINK =
  'tap-area font-medium underline decoration-1 underline-offset-4 transition-colors duration-300 hover:decoration-leaf focus-visible:decoration-leaf';

/**
 * /orgs/:slug, the fixed organization page template (docs/DOMAIN_RULES.md, "Organization
 * page"): a compact header (logo in its hexagon, name, college, tagline, links and the rank
 * badge) between the prototype's wave bands, then the sections (organization-record.tsx).
 * Organizations fill in its content; the layout is the same for every one.
 */
export function OrganizationView(props: OrganizationViewProps) {
  return (
    <main className="bg-surface-sweep">
      {props.status === 'ready' ? (
        <Seo seo={props.page.seo} />
      ) : (
        <title>Organization | Orghive</title>
      )}
      <OrganizationHero {...props} />
      {props.status === 'ready' ? (
        <OrganizationRecord
          page={props.page}
          constitution={props.constitution}
          posts={props.posts}
          showcase={props.showcase}
        />
      ) : null}
    </main>
  );
}

/** The header. `preview` (the profile editor) skips the arrival motion and LCP hints. */
export function OrganizationHero(props: OrganizationViewProps & { preview?: boolean }) {
  return (
    <div className="relative isolate overflow-hidden">
      <WaveDivider className="pointer-events-none absolute inset-x-0 top-0 -z-10 -translate-y-[45%]" />
      <WaveDivider className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 translate-y-[55%] rotate-180" />

      <Container className="pt-[calc(8vw+2rem)] pb-[calc(7vw+2.5rem)]">
        {props.status === 'ready' ? (
          <OrganizationHeader
            page={props.page}
            rank={props.showcase?.status === 'ready' ? props.showcase.showcase.rank : null}
            preview={props.preview}
          />
        ) : props.status === 'error' ? (
          <div>
            <h1 className="text-display font-bold text-ink">Organization</h1>
            <SectionError
              className="mt-8"
              message="This organization could not be loaded. Check your connection and try again."
              onRetry={props.retry}
            />
          </div>
        ) : (
          <HeaderSkeleton />
        )}
      </Container>
    </div>
  );
}

function OrganizationHeader({
  page,
  rank,
  preview,
}: {
  page: OrganizationPageModel;
  rank: RankBadgeModel | null;
  preview?: boolean;
}) {
  const Block = preview ? 'div' : Reveal;
  return (
    <Block className="flex flex-col gap-6 md:flex-row md:items-center md:gap-10 lg:gap-14">
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
      <div className="min-w-0">
        {page.sample ? <SampleDataChip className="mb-4" /> : null}
        <h1 className="text-display font-bold break-words text-ink">
          <span className="block">{page.acronym}</span>{' '}
          <span className="mt-2 block max-w-[34rem] text-lead font-normal tracking-normal text-pretty text-forest-700">
            {page.name}
          </span>
        </h1>
        {page.context ? (
          <p className="mt-2 text-small text-ink">
            {page.context.lead}{' '}
            <OriginLink
              to={page.context.college.href}
              className={`${LINK} inline-flex min-h-11 items-center`}
            >
              {page.context.college.name}
            </OriginLink>
          </p>
        ) : null}
        {page.tagline ? (
          <p className="mt-4 max-w-[40rem] text-body-lg text-pretty text-ink">{page.tagline}</p>
        ) : null}
        {page.contact || rank ? (
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
            <SocialLinks page={page} />
            {page.contact && rank ? (
              <span aria-hidden="true" className="hidden h-8 w-px bg-sage/70 sm:block" />
            ) : null}
            {rank ? <RankBadge rank={rank} /> : null}
          </div>
        ) : null}
      </div>
    </Block>
  );
}

/** "3rd on the SBO leaderboard": a gold hexagon with the place, linked to the board. */
function RankBadge({ rank }: { rank: RankBadgeModel }) {
  return (
    <OriginLink
      to={rank.href}
      className="group inline-flex min-h-11 items-center gap-3 rounded-full border border-medal-gold bg-white/80 py-1.5 pr-5 pl-1.5 transition-colors duration-300 hover:bg-white focus-visible:bg-white"
    >
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center bg-medal-gold text-small font-bold text-white"
        style={{ clipPath: HEX_CLIP.pointy }}
      >
        {rank.rank}
      </span>
      <span className="min-w-0">
        <span className="block text-small font-semibold text-medal-gold-ink">{rank.label}</span>{' '}
        <span className="block text-caption text-ink-muted">{rank.detail}</span>
      </span>
    </OriginLink>
  );
}

function HeaderSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6 md:flex-row md:items-center md:gap-10 lg:gap-14">
      <HexFrame
        shadow={false}
        className={`${HEX} animate-pulse opacity-70 motion-reduce:animate-none`}
      />
      <div className="min-w-0 flex-1">
        <h1 className="sr-only">Loading the organization</h1>
        <Skeleton className="h-12 w-48 lg:h-[4.5rem] lg:w-64" />
        <Skeleton className="mt-4 h-5 w-80 max-w-full" />
        <Skeleton className="mt-3 h-4 w-56 max-w-full" />
        <Skeleton className="mt-6 h-5 w-[28rem] max-w-full" />
        <div className="mt-6 flex gap-2">
          <Skeleton className="size-11 rounded-full" />
          <Skeleton className="size-11 rounded-full" />
          <Skeleton className="h-11 w-56 rounded-full" />
        </div>
      </div>
    </div>
  );
}
