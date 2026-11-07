import { ChevronLeft, ChevronRight, Rss } from 'lucide-react';
import { Link } from 'react-router';
import type { PageSeo } from '@orghive/shared';
import { Container } from '@/components/container';
import { SectionError } from '@/components/section-error';
import { Seo } from '@/components/seo';
import { Skeleton } from '@/components/skeleton';
import { cn } from '@/lib/utils';
import type { OrgUpdatesState, UpdatesFilterLink } from '../presenters/use-org-updates';
import { PostRow } from './org-post-sections';

export interface OrgUpdatesViewProps {
  state: OrgUpdatesState;
  acronym: string;
  seo: PageSeo | null;
  rssUrl: string;
}

const CHIP =
  'inline-flex h-11 items-center rounded-full px-5 text-body transition-colors duration-300 motion-reduce:transition-none';

/**
 * /orgs/:slug/updates: an academic-site style news list (date, title, summary), newest
 * first, filtered by type and Manila year, ten to a page.
 */
export function OrgUpdatesView({ state, acronym, seo, rssUrl }: OrgUpdatesViewProps) {
  return (
    <main className="bg-surface-sweep min-h-page">
      {seo ? <Seo seo={seo} /> : <title>{`${acronym} updates | Orghive`}</title>}
      <link rel="alternate" type="application/rss+xml" title={`${acronym} updates`} href={rssUrl} />
      <Container className="pt-12 pb-section">
        <div className="max-w-4xl">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h1 className="text-h1 font-bold text-balance text-ink">{acronym} updates</h1>
            <a
              href={rssUrl}
              className="tap-area inline-flex items-center gap-2 text-small font-medium text-ink underline decoration-1 underline-offset-4 hover:decoration-leaf focus-visible:decoration-leaf"
            >
              <Rss aria-hidden="true" className="size-4" />
              RSS feed
            </a>
          </div>

          {state.status === 'ready' ? (
            <>
              <FilterRow label="Show" links={state.model.types} />
              {state.model.years.length > 1 ? (
                <FilterRow label="Year" links={state.model.years} className="mt-3" />
              ) : null}
              <p className="mt-6 text-small text-ink-muted" aria-live="polite">
                {state.model.summary}
              </p>
              {state.model.posts.length > 0 ? (
                <ol className="mt-4 border-b border-sage/50">
                  {state.model.posts.map((post) => (
                    <li key={post.id}>
                      <PostRow post={post} />
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-10 max-w-prose text-body-lg text-pretty text-ink">
                  Nothing here yet. {acronym}’s updates and highlights appear on this page as they are
                  posted.
                </p>
              )}
              {state.model.pages > 1 ? (
                <nav aria-label="Pages" className="mt-10 flex items-center justify-between gap-4">
                  <PageLink href={state.model.newer} label="Newer">
                    <ChevronLeft aria-hidden="true" className="size-4" />
                  </PageLink>
                  <p className="text-small text-ink-muted">
                    Page {state.model.page} of {state.model.pages}
                  </p>
                  <PageLink href={state.model.older} label="Older" after>
                    <ChevronRight aria-hidden="true" className="size-4" />
                  </PageLink>
                </nav>
              ) : null}
            </>
          ) : state.status === 'error' ? (
            <SectionError
              className="mt-10"
              message="The updates could not be loaded. Check your connection and try again."
              onRetry={state.retry}
            />
          ) : (
            <div aria-busy="true" className="mt-10 space-y-6">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          )}
        </div>
      </Container>
    </main>
  );
}

function FilterRow({
  label,
  links,
  className,
}: {
  label: string;
  links: UpdatesFilterLink[];
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn('mt-8 flex flex-wrap gap-2', className)}>
      {links.map((link) => (
        <Link
          key={link.label}
          to={link.href}
          aria-current={link.current ? 'page' : undefined}
          replace
          className={cn(
            CHIP,
            link.current
              ? 'bg-forest-700 font-medium text-white'
              : 'bg-white text-ink hover:bg-pill-light focus-visible:bg-pill-light',
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

function PageLink({
  href,
  label,
  after = false,
  children,
}: {
  href: string | null;
  label: string;
  after?: boolean;
  children: React.ReactNode;
}) {
  const inner = after ? (
    <>
      {label}
      {children}
    </>
  ) : (
    <>
      {children}
      {label}
    </>
  );
  if (!href) {
    return (
      <span aria-hidden="true" className={cn(CHIP, 'gap-2 border border-sage/60 text-ink-muted')}>
        {inner}
      </span>
    );
  }
  return (
    <Link to={href} className={cn(CHIP, 'gap-2 border-[1.5px] border-ink font-medium text-ink')}>
      {inner}
    </Link>
  );
}
