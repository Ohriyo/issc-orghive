import { ArrowRight, PenLine } from 'lucide-react';
import { Container } from '@/components/container';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { OriginLink } from '@/navigation/origin-link';
import { COVER_SIZES, type PostCardModel } from '../presenters/post-format';
import type { OrgPostSectionsState } from '../presenters/use-org-post-sections';
import { HighlightCarousel, type HighlightCarouselProps } from './highlight-carousel';

export interface OrgPostSectionsProps {
  state: OrgPostSectionsState;
  org: HighlightCarouselProps['org'];
}

/**
 * The post sections of /orgs/:slug, between the hero and the profile record: the pinned
 * highlights carousel, then the newest updates as a news list. Each hides when it has
 * nothing to show; while loading, a quiet placeholder holds the place.
 */
export function OrgPostSections({ state, org }: OrgPostSectionsProps) {
  if (state.status === 'loading') {
    return (
      <Container className="pt-section" aria-busy="true">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="mt-8 aspect-[16/7] w-full rounded-[1.75rem] max-md:aspect-[3/4]" />
      </Container>
    );
  }
  if (state.status === 'error') {
    return (
      <Container className="pt-section">
        <SectionError
          message="Highlights and updates could not be loaded. Check your connection and try again."
          onRetry={state.retry}
        />
      </Container>
    );
  }
  const { sections } = state;
  return (
    <>
      {sections.highlights.length > 0 ? (
        <HighlightCarousel
          highlights={sections.highlights}
          org={org}
          seeAllHref={sections.highlightsHref}
        />
      ) : null}
      {sections.updates.length > 0 ? (
        <RecentUpdates
          updates={sections.updates}
          total={sections.updatesTotal}
          href={sections.updatesHref}
        />
      ) : null}
      {sections.isOwner ? (
        <Container className="pt-8">
          <OriginLink
            to="/dashboard/posts"
            className="tap-area inline-flex items-center gap-2 font-medium text-ink underline decoration-1 underline-offset-4 hover:decoration-leaf focus-visible:decoration-leaf"
          >
            <PenLine aria-hidden="true" className="size-4" />
            Manage {org.acronym}’s highlights and updates
          </OriginLink>
        </Container>
      ) : null}
    </>
  );
}

/** The newest updates, newest first: date, title, summary and a thumbnail when it has one. */
export function RecentUpdates({
  updates,
  total,
  href,
}: {
  updates: PostCardModel[];
  total: number;
  href: string;
}) {
  return (
    <section aria-labelledby="updates-heading">
      <Container className="pt-section">
        <h2 id="updates-heading" className="text-h2 font-bold text-balance text-ink">
          Updates
        </h2>
        <ol className="mt-8 border-b border-sage/50">
          {updates.map((update) => (
            <li key={update.id}>
              <PostRow post={update} />
            </li>
          ))}
        </ol>
        <PillButton asChild variant="light" className="mt-8 border border-ink">
          <OriginLink to={href}>
            {total > updates.length ? `View all ${total} updates` : 'View all updates'}
            <ArrowRight aria-hidden="true" />
          </OriginLink>
        </PillButton>
      </Container>
    </section>
  );
}

/** One news row: the date in its own column, then the title and summary, then a thumbnail. */
export function PostRow({ post }: { post: PostCardModel }) {
  return (
    <article className="grid gap-x-8 gap-y-1 border-t border-sage/50 py-6 md:grid-cols-[9rem_minmax(0,1fr)_auto]">
      <time dateTime={post.dateTime} className="text-small font-medium text-ink-muted md:pt-1">
        {post.date}
      </time>
      <div className="min-w-0 max-w-[65ch]">
        <h3 className="text-body-lg font-semibold text-pretty text-ink">
          <OriginLink
            to={post.href}
            className="underline-offset-4 tap-area hover:underline focus-visible:underline"
          >
            {post.title}
          </OriginLink>
        </h3>
        <p className="mt-1 line-clamp-2 text-body text-pretty text-ink-muted">{post.summary}</p>
      </div>
      {post.cover ? (
        <img
          src={post.cover.url}
          srcSet={post.cover.srcSet ?? undefined}
          sizes={COVER_SIZES.thumb}
          alt=""
          loading="lazy"
          decoding="async"
          className="hidden aspect-[4/3] w-32 rounded-xl bg-surface-deep object-cover md:block"
        />
      ) : null}
    </article>
  );
}
