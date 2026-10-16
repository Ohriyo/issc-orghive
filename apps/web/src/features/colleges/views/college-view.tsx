import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router';
import { Container } from '@/components/container';
import { LOGO_SIZES } from '@/components/logo-sizes';
import { EmphasizedText } from '@/components/emphasized-text';
import { HexFrame } from '@/components/hex-frame';
import { HexGrid } from '@/components/hex-grid';
import { OrgLogo } from '@/components/org-logo';
import { PillButton } from '@/components/pill-button';
import { Reveal } from '@/components/reveal';
import { SectionError } from '@/components/section-error';
import { Seo } from '@/components/seo';
import { Skeleton } from '@/components/skeleton';
import { WaveDivider } from '@/components/wave-divider';
import { cn } from '@/lib/utils';
import type { CollegePageModel, CollegePageState, CscCard } from '../presenters/use-college-page';

export type CollegeViewProps = Exclude<CollegePageState, { status: 'not-found' }>;

/*
 * Layout, from design/college-cea.png: the college name and description on the left; the
 * honeycomb of SBO logos on the right, bleeding off the top and right edges on wide screens
 * (positioned against the section, like the home hero). A wave divider sweeps across the
 * bottom of the honeycomb into the CSC card: its logo in a large hexagon, then its name,
 * description, and the Paperworks and SBO pills.
 */
/*
 * The honeycomb is anchored to the section's bottom, not its top, so its last row always
 * tucks under the wave's ink band however long the description runs; the text column is
 * padded by the wave's overlap (WAVE_OVERLAP) so the wave never covers it.
 */
const HONEYCOMB_BOX =
  'mt-12 xl:absolute xl:bottom-[calc(min(9vw,8rem)*-0.15)] xl:left-[calc(50%-6rem)] xl:mt-0 xl:w-[min(60vw,52rem)]';
const TITLE = 'text-title font-bold text-balance text-ink';
const COLUMN = 'relative z-10 xl:max-w-[calc(50%-8rem)]';

export function CollegeView(props: CollegeViewProps) {
  // The honeycomb is positioned out of flow, so the section reserves its height, but only
  // when there is one: a college without SBOs would otherwise open on an empty gap.
  const hasHoneycomb =
    props.status === 'loading' || (props.status === 'ready' && props.page.sboCount > 0);
  return (
    <div className="bg-surface-sweep relative min-h-dvh overflow-x-clip">
      {props.status === 'ready' ? <Seo seo={props.page.seo} /> : <title>College | Orghive</title>}
      <main>
        <section
          aria-labelledby="college-heading"
          className={cn(
            'relative isolate',
            hasHoneycomb && 'xl:min-h-[calc(min(60vw,52rem)*0.77+2rem)]',
          )}
        >
          <Container className="pt-6 pb-4 lg:pt-10 xl:pb-[calc(min(9vw,8rem)+2rem)]">
            <Link
              to="/colleges"
              className="relative z-10 inline-flex items-center gap-2 text-body font-medium text-ink underline decoration-1 underline-offset-4 transition-colors duration-300 tap-area hover:decoration-leaf focus-visible:decoration-leaf"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              All colleges
            </Link>
            <div className="pt-10 lg:pt-14">
              {props.status === 'ready' ? (
                <CollegeIntro page={props.page} />
              ) : props.status === 'error' ? (
                <div className={COLUMN}>
                  <h1 id="college-heading" className={TITLE}>
                    College
                  </h1>
                  <SectionError
                    className="mt-8"
                    message="This college could not be loaded. Check your connection and try again."
                    onRetry={props.retry}
                  />
                </div>
              ) : (
                <IntroSkeleton />
              )}
            </div>
          </Container>
        </section>

        <WaveDivider className="relative z-10 -mt-4 xl:-mt-[min(9vw,8rem)]" />

        {props.status === 'ready' ? (
          <CscSection
            csc={props.page.csc}
            collegeName={props.page.name}
            code={props.page.code}
            sbosHref={props.page.sbosHref}
            sboCount={props.page.sboCount}
          />
        ) : props.status === 'loading' ? (
          <CscSkeleton />
        ) : null}
      </main>
    </div>
  );
}

function CollegeIntro({ page }: { page: CollegePageModel }) {
  return (
    <>
      <div className={COLUMN}>
        <h1 id="college-heading" className={TITLE}>
          {page.name}
        </h1>
        {page.intro ? (
          <p className="mt-8 max-w-[34rem] text-lead text-pretty text-ink lg:mt-10">
            <EmphasizedText segments={page.intro} />
          </p>
        ) : null}
        {page.sboCount === 0 ? (
          <p className="mt-6 max-w-[34rem] text-body text-ink-muted">
            No student body organizations have been added to this college yet.
          </p>
        ) : null}
      </div>
      {page.sboCount > 0 ? (
        <HexGrid
          label={`Student body organizations of the ${page.name}`}
          cells={page.honeycomb}
          columns={4}
          mobileColumns={2}
          className={HONEYCOMB_BOX}
        />
      ) : null}
    </>
  );
}

function IntroSkeleton() {
  return (
    <div aria-busy="true">
      <h1 id="college-heading" className="sr-only">
        Loading the college
      </h1>
      <div className={COLUMN}>
        <div className="space-y-3">
          <Skeleton className="h-(--text-title) w-[85%]" />
          <Skeleton className="h-(--text-title) w-full" />
          <Skeleton className="h-(--text-title) w-[70%]" />
        </div>
        <div className="mt-10 max-w-[34rem] space-y-3">
          {['w-full', 'w-[94%]', 'w-full', 'w-[88%]', 'w-[60%]'].map((width) => (
            <Skeleton key={width} className={`h-4 ${width}`} />
          ))}
        </div>
      </div>
      <HexGrid
        cells={[]}
        isLoading
        columns={4}
        mobileColumns={2}
        skeletonCount={12}
        mobileSkeletonCount={6}
        className={HONEYCOMB_BOX}
      />
    </div>
  );
}

interface CscSectionProps {
  csc: CscCard | null;
  collegeName: string;
  code: string;
  sbosHref: string;
  sboCount: number;
}

function CscSection({ csc, collegeName, code, sbosHref, sboCount }: CscSectionProps) {
  const heading = csc?.acronym ?? `CSC-${code}`;
  return (
    <section aria-labelledby="csc-heading" className="relative">
      <Container
        asChild
        className="grid items-center gap-12 pt-4 pb-section-lg lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] lg:gap-16"
      >
        <Reveal>
          <div className="lg:order-last">
            <h2 id="csc-heading" className="text-display font-bold text-ink">
              <span className="block">{heading}</span>{' '}
              <span className="mt-3 block text-lead font-normal tracking-normal text-pretty">
                {csc?.name ?? `Collegiate Student Council of the ${collegeName}`}
              </span>
            </h2>
            {csc?.description ? (
              <p className="mt-8 max-w-[30rem] text-body-lg text-pretty text-ink">
                <EmphasizedText segments={csc.description} />
              </p>
            ) : null}
            {!csc ? (
              <p className="mt-8 max-w-[30rem] text-body text-ink-muted">
                This college&rsquo;s student council has not been added yet. Its Paperworks will
                appear here once an admin adds it.
              </p>
            ) : null}
            {csc || sboCount > 0 ? (
              <nav aria-label={`${heading} sections`} className="mt-10">
                <ul className="flex flex-wrap gap-x-8 gap-y-4">
                  {csc ? (
                    <li>
                      <PillButton asChild size="lg">
                        <Link to={csc.paperworksHref}>Paperworks</Link>
                      </PillButton>
                    </li>
                  ) : null}
                  {sboCount > 0 ? (
                    <li>
                      <PillButton asChild size="lg">
                        <Link to={sbosHref} className="underline decoration-1 underline-offset-4">
                          SBO <span className="sr-only">(student body organizations)</span>
                        </Link>
                      </PillButton>
                    </li>
                  ) : null}
                </ul>
              </nav>
            ) : null}
          </div>
          <HexFrame className="mx-auto w-full max-w-[20rem] sm:max-w-[26rem] lg:max-w-[34rem]">
            <OrgLogo
              name={csc?.name ?? heading}
              src={csc?.logoSrc}
              srcSet={csc?.logoSrcSet}
              sizes={LOGO_SIZES.feature}
              alt=""
              fallbackText={heading}
              className="size-full"
            />
          </HexFrame>
        </Reveal>
      </Container>
    </section>
  );
}

function CscSkeleton() {
  return (
    <Container
      aria-hidden="true"
      className="grid items-center gap-12 pt-4 pb-section-lg lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] lg:gap-16"
    >
      <div className="lg:order-last">
        <Skeleton className="h-12 w-56 lg:h-16 lg:w-72" />
        <Skeleton className="mt-4 h-5 w-80 max-w-full" />
        <Skeleton className="mt-2 h-5 w-64 max-w-full" />
        <div className="mt-8 max-w-[30rem] space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-[92%]" />
          <Skeleton className="h-4 w-[75%]" />
        </div>
        <div className="mt-10 flex gap-8">
          <Skeleton className="h-14 w-44" />
          <Skeleton className="h-14 w-32" />
        </div>
      </div>
      <HexFrame
        shadow={false}
        className="mx-auto w-full max-w-[20rem] animate-pulse opacity-70 motion-reduce:animate-none sm:max-w-[26rem] lg:max-w-[34rem]"
      />
    </Container>
  );
}
