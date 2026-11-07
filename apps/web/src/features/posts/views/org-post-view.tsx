import { ArrowLeft, ArrowRight, ArrowUpRight, EyeOff, Info, PenLine, TriangleAlert } from 'lucide-react';
import { ActingAsField } from '@/components/acting-as-field';
import { Container } from '@/components/container';
import { TextAreaField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Seo } from '@/components/seo';
import { Skeleton } from '@/components/skeleton';
import { cn } from '@/lib/utils';
import { OriginLink } from '@/navigation/origin-link';
import { COVER_SIZES } from '../presenters/post-format';
import type { HideModel, OrgPostModel, OrgPostState } from '../presenters/use-org-post';

export type OrgPostViewProps = Exclude<OrgPostState, { status: 'not-found' }>;

const LINK =
  'tap-area font-medium text-ink underline decoration-1 underline-offset-4 transition-colors duration-300 hover:decoration-leaf focus-visible:decoration-leaf';

/**
 * /orgs/:slug/updates/:postSlug: one update or highlight, read like an article. Title and
 * date, the cover, the body (sanitized HTML from the server), the photo gallery, then the
 * previous and next posts. The organization's own account sees why a post is not public;
 * its governing body may hide it, with a reason.
 */
export function OrgPostView(props: OrgPostViewProps) {
  if (props.status === 'loading') {
    return (
      <main aria-busy="true" className="bg-surface-sweep min-h-page">
        <title>Update | Orghive</title>
        <Container className="max-w-3xl pt-12 pb-section">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="mt-6 h-12 w-full" />
          <Skeleton className="mt-3 h-12 w-2/3" />
          <Skeleton className="mt-10 aspect-[16/9] w-full rounded-[1.5rem]" />
        </Container>
      </main>
    );
  }
  if (props.status === 'error') {
    return (
      <main className="bg-surface-sweep min-h-page">
        <title>Update | Orghive</title>
        <Container className="max-w-3xl pt-12 pb-section">
          <SectionError
            message="This post could not be loaded. Check your connection and try again."
            onRetry={props.retry}
          />
        </Container>
      </main>
    );
  }
  const { post, hide } = props;
  return (
    <main className="bg-surface-sweep min-h-page">
      <Seo seo={post.seo} />
      <article className="pt-12 pb-section">
        <Container className="max-w-3xl">
          {post.ownerNotice ? <OwnerNotice notice={post.ownerNotice} editHref={post.editHref} /> : null}
          <p className="text-small font-medium text-ink-muted">
            <OriginLink to={post.org.href} className={`${LINK} inline-flex min-h-11 items-center`}>
              {post.org.acronym}
            </OriginLink>{' '}
            · {post.kind}
          </p>
          <h1 className="mt-4 text-h1 font-bold text-balance text-ink">{post.title}</h1>
          <p className="mt-4 text-body text-ink-muted">
            <time dateTime={post.dateTime}>{post.posted}</time>
            {post.event ? <span className="block sm:inline sm:before:content-['_·_']">{post.event}</span> : null}
          </p>
          {post.editHref && !post.ownerNotice ? (
            <OriginLink to={post.editHref} className={cn(LINK, 'mt-4 inline-flex items-center gap-2')}>
              <PenLine aria-hidden="true" className="size-4" />
              Edit this post
            </OriginLink>
          ) : null}
        </Container>

        {post.cover ? (
          <Container className="mt-10 max-w-5xl">
            <img
              src={post.cover.url}
              srcSet={post.cover.srcSet ?? undefined}
              sizes={COVER_SIZES.article}
              alt={post.cover.alt}
              decoding="async"
              fetchPriority="high"
              className="aspect-[16/9] w-full rounded-[1.5rem] bg-surface-deep object-cover shadow-pool"
            />
          </Container>
        ) : null}

        <Container className="mt-10 max-w-3xl">
          {post.bodyHtml ? (
            // Sanitized on the server with an allow-list (apps/api/src/lib/markdown.ts).
            <div
              className="post-body text-body-lg text-pretty text-ink"
              dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
            />
          ) : null}
          {post.externalLink ? (
            <p className="mt-8">
              <a
                href={post.externalLink}
                target="_blank"
                rel="noopener nofollow"
                className={cn(LINK, 'inline-flex items-center gap-1')}
              >
                More about this
                <ArrowUpRight aria-hidden="true" className="size-4" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </p>
          ) : null}
        </Container>

        {post.gallery.length > 0 ? (
          <Container as="section" aria-labelledby="gallery-heading" className="mt-14 max-w-5xl">
            <h2 id="gallery-heading" className="text-h3 font-bold text-ink">
              Photos
            </h2>
            <ul className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
              {post.gallery.map((image, i) => (
                <li key={image.url}>
                  <a
                    href={image.url}
                    target="_blank"
                    rel="noopener"
                    className="block overflow-hidden rounded-2xl focus-visible:outline-offset-4"
                  >
                    <img
                      src={image.url}
                      srcSet={image.srcSet ?? undefined}
                      sizes={COVER_SIZES.gallery}
                      alt={image.alt}
                      loading="lazy"
                      decoding="async"
                      className="aspect-[4/3] w-full bg-surface-deep object-cover transition-transform duration-500 hover:scale-[1.03] motion-reduce:transition-none"
                    />
                    <span className="sr-only">Open photo {i + 1} full size (new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          </Container>
        ) : null}

        <Container className="mt-16 max-w-5xl">
          <PrevNext post={post} />
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <PillButton asChild variant="light" className="border border-ink">
              <OriginLink to={post.allHref}>All {post.org.acronym} updates</OriginLink>
            </PillButton>
          </div>
          {post.canModerate ? <HidePanel hide={hide} acronym={post.org.acronym} /> : null}
        </Container>
      </article>
    </main>
  );
}

function OwnerNotice({
  notice,
  editHref,
}: {
  notice: NonNullable<OrgPostModel['ownerNotice']>;
  editHref: string | null;
}) {
  const Icon = notice.tone === 'warning' ? TriangleAlert : Info;
  return (
    <div
      role="status"
      className={cn(
        'mb-8 flex gap-3 rounded-2xl p-4',
        notice.tone === 'warning' ? 'bg-caution-surface text-caution' : 'bg-white text-ink',
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="text-body">
        <p>{notice.text}</p>
        {editHref ? (
          <OriginLink to={editHref} className={cn(LINK, 'mt-2 inline-block text-current')}>
            Edit this post
          </OriginLink>
        ) : null}
      </div>
    </div>
  );
}

function PrevNext({ post }: { post: OrgPostModel }) {
  if (!post.previous && !post.next) return null;
  const CARD =
    'group flex min-h-11 flex-col gap-1 rounded-2xl border border-sage/50 bg-white p-5 transition-colors duration-300 hover:border-forest-500 focus-visible:border-forest-500 motion-reduce:transition-none';
  return (
    <nav aria-label="More posts" className="grid gap-4 md:grid-cols-2">
      {post.previous ? (
        <OriginLink to={post.previous.href} className={CARD}>
          <span className="inline-flex items-center gap-1 text-small text-ink-muted">
            <ArrowLeft aria-hidden="true" className="size-4" />
            Older
          </span>
          <span className="text-body-lg font-semibold text-pretty text-ink">{post.previous.title}</span>
        </OriginLink>
      ) : (
        <span className="max-md:hidden" />
      )}
      {post.next ? (
        <OriginLink to={post.next.href} className={cn(CARD, 'md:items-end md:text-right')}>
          <span className="inline-flex items-center gap-1 text-small text-ink-muted">
            Newer
            <ArrowRight aria-hidden="true" className="size-4" />
          </span>
          <span className="text-body-lg font-semibold text-pretty text-ink">{post.next.title}</span>
        </OriginLink>
      ) : null}
    </nav>
  );
}

/** A governing body's moderation: hide with a reason. The organization is told why. */
function HidePanel({ hide, acronym }: { hide: HideModel; acronym: string }) {
  if (!hide.open) {
    return (
      <div className="mt-12 flex justify-center">
        <button
          type="button"
          onClick={() => hide.setOpen(true)}
          className={cn(LINK, 'inline-flex items-center gap-2 text-caution')}
        >
          <EyeOff aria-hidden="true" className="size-4" />
          Hide this post
        </button>
      </div>
    );
  }
  return (
    <form
      className="mx-auto mt-12 max-w-xl rounded-2xl border border-sage/60 bg-white p-6"
      onSubmit={(event) => {
        event.preventDefault();
        hide.submit();
      }}
    >
      <h2 className="text-h3 font-bold text-ink">Hide this post</h2>
      <p className="mt-2 text-body text-pretty text-ink-muted">
        Only {acronym} will see it. {acronym} is told your reason and may edit the post and publish
        it again.
      </p>
      <TextAreaField
        className="mt-5"
        label="Reason"
        value={hide.reason}
        onChange={(event) => hide.setReason(event.target.value)}
        error={hide.reasonError}
        maxLength={500}
        required
      />
      <ActingAsField
        className="mt-4"
        orgAcronym={hide.moderatorAcronym}
        savedWith="this decision"
        value={hide.actingAs.value}
        onChange={(event) => hide.actingAs.onChange(event.target.value)}
        error={hide.actingAs.error}
      />
      <div className="mt-6 flex flex-wrap gap-3">
        <PillButton type="submit" disabled={hide.pending}>
          {hide.pending ? 'Hiding…' : 'Hide post'}
        </PillButton>
        <PillButton type="button" variant="light" onClick={() => hide.setOpen(false)}>
          Cancel
        </PillButton>
      </div>
    </form>
  );
}
