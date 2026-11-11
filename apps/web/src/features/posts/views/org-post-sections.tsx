import { cn } from '@/lib/utils';
import { OriginLink } from '@/navigation/origin-link';
import { COVER_SIZES, type PostCardModel } from '../presenters/post-format';

/** One news row: the date in its own column, then the title and summary, then a thumbnail. */
export function PostRow({ post, compact }: { post: PostCardModel; compact?: boolean }) {
  return (
    <article
      className={cn(
        'grid gap-x-8 gap-y-1 border-t border-sage/50 py-6',
        compact
          ? 'md:grid-cols-[7rem_minmax(0,1fr)_auto] md:gap-x-6 md:py-5'
          : 'md:grid-cols-[9rem_minmax(0,1fr)_auto]',
      )}
    >
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
          className={cn(
            'hidden aspect-[4/3] rounded-xl bg-surface-deep object-cover md:block',
            compact ? 'w-24' : 'w-32',
          )}
        />
      ) : null}
    </article>
  );
}
