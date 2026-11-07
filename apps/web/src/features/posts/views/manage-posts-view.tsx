import { ArrowDown, ArrowUp, Pin, PinOff, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { PINNED_HIGHLIGHTS_MAX } from '@orghive/shared';
import { ActingAsField } from '@/components/acting-as-field';
import { Container } from '@/components/container';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { cn } from '@/lib/utils';
import { OriginLink } from '@/navigation/origin-link';
import type { ManagedPostRow, ManagePostsModel, ManagePostsState } from '../presenters/use-manage-posts';

const LINK =
  'tap-area font-medium text-ink underline decoration-1 underline-offset-4 transition-colors duration-300 hover:decoration-leaf focus-visible:decoration-leaf';
const SMALL_BUTTON =
  'inline-flex h-11 items-center gap-2 rounded-full border border-sage/70 bg-white px-4 text-small font-medium text-ink transition-colors duration-300 hover:border-forest-500 focus-visible:border-forest-500 disabled:opacity-50 motion-reduce:transition-none';
const STATUS_STYLE: Record<ManagedPostRow['status'], string> = {
  DRAFT: 'bg-pill-light text-ink',
  SCHEDULED: 'bg-white text-ink ring-1 ring-sage',
  PUBLISHED: 'bg-forest-700 text-white',
  HIDDEN: 'bg-caution-surface text-caution',
};

/**
 * /dashboard/posts: the organization's highlights and updates in every state, with the
 * carousel's pins. Every action names who is acting for the shared account.
 */
export function ManagePostsView({ state }: { state: ManagePostsState }) {
  return (
    <Container as="main" className="pt-8 pb-section">
      <title>Highlights and updates | Orghive</title>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-h1 font-bold text-balance text-ink">Highlights and updates</h1>
        {state.status === 'ready' ? (
          <PillButton asChild>
            <OriginLink to="/dashboard/posts/new">
              <Plus aria-hidden="true" />
              New post
            </OriginLink>
          </PillButton>
        ) : null}
      </div>
      {state.status === 'ready' ? (
        <Ready model={state.model} />
      ) : state.status === 'no-organization' ? (
        <p className="mt-8 max-w-prose text-body-lg text-ink">
          Posts belong to an organization. Sign in with your organization’s account to write them.
        </p>
      ) : state.status === 'error' ? (
        <SectionError
          className="mt-8"
          message="Your posts could not be loaded. Check your connection and try again."
          onRetry={state.retry}
        />
      ) : (
        <div aria-busy="true" className="mt-8 space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}
    </Container>
  );
}

function Ready({ model }: { model: ManagePostsModel }) {
  return (
    <>
      <p className="mt-3 max-w-prose text-body text-pretty text-ink-muted">
        They show on{' '}
        <OriginLink to={`/orgs/${model.org.slug}`} className={LINK}>
          {model.org.acronym}’s page
        </OriginLink>{' '}
        as soon as you publish them. No approval is needed; your CSC or the ISSC may hide a post
        and tell you why.
      </p>
      <ActingAsField
        className="mt-6 max-w-md"
        orgAcronym={model.org.acronym}
        savedWith="each change"
        value={model.actingAs.value}
        onChange={(event) => model.actingAs.onChange(event.target.value)}
        error={model.actingAs.error}
      />

      <section aria-labelledby="pins-heading" className="mt-10 rounded-[1.5rem] border border-sage/50 bg-white p-5 md:p-6">
        <h2 id="pins-heading" className="text-h3 font-bold text-ink">
          Highlights carousel
        </h2>
        <p className="mt-1 text-small text-ink-muted">
          Pin up to {PINNED_HIGHLIGHTS_MAX} published highlights. The first one shows first.
        </p>
        {model.pinned.length > 0 ? (
          <ol className="mt-4 divide-y divide-sage/40">
            {model.pinned.map((row, i) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-forest-700 text-small font-semibold text-white">
                  {row.place}
                </span>
                <span className="min-w-0 flex-1 text-body font-medium text-pretty text-ink">{row.title}</span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    disabled={model.busy || i === 0}
                    onClick={() => model.move(row.id, -1)}
                    aria-label={`Move “${row.title}” up`}
                  >
                    <ArrowUp aria-hidden="true" className="size-4" />
                  </button>
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    disabled={model.busy || i === model.pinned.length - 1}
                    onClick={() => model.move(row.id, 1)}
                    aria-label={`Move “${row.title}” down`}
                  >
                    <ArrowDown aria-hidden="true" className="size-4" />
                  </button>
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    disabled={model.busy}
                    onClick={() => model.unpin(row.id)}
                  >
                    <PinOff aria-hidden="true" className="size-4" />
                    Unpin
                  </button>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-4 text-body text-ink">Nothing pinned: the page shows no carousel.</p>
        )}
        {model.pinnable.length > 0 ? (
          <div className="mt-4 border-t border-sage/40 pt-4">
            <h3 className="text-small font-semibold text-ink">Published highlights you can pin</h3>
            <ul className="mt-2 divide-y divide-sage/40">
              {model.pinnable.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="min-w-0 flex-1 text-body text-pretty text-ink">{row.title}</span>
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    disabled={model.busy || !model.canPinMore}
                    onClick={() => model.pin(row.id)}
                  >
                    <Pin aria-hidden="true" className="size-4" />
                    Pin
                  </button>
                </li>
              ))}
            </ul>
            {!model.canPinMore ? (
              <p className="mt-2 text-small text-ink-muted">
                The carousel is full. Unpin one to pin another.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <nav aria-label="Filter posts" className="mt-10 flex flex-wrap gap-2">
        {model.tabs.map((tab) => (
          <Link
            key={tab.label}
            to={tab.href}
            replace
            aria-current={tab.current ? 'page' : undefined}
            className={cn(
              'inline-flex h-11 items-center rounded-full px-5 text-body transition-colors duration-300 motion-reduce:transition-none',
              tab.current
                ? 'bg-forest-700 font-medium text-white'
                : 'bg-white text-ink hover:bg-pill-light focus-visible:bg-pill-light',
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {model.rows.length > 0 ? (
        <ul className="mt-6 divide-y divide-sage/40 border-y border-sage/40">
          {model.rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-3 py-5 md:flex-row md:items-center">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-small text-ink-muted">
                  <span className={cn('rounded-full px-2.5 py-0.5 text-small font-medium', STATUS_STYLE[row.status])}>
                    {row.statusLabel}
                  </span>
                  {row.kind}
                </p>
                <p className="mt-1.5 text-body-lg font-semibold text-pretty text-ink">
                  <OriginLink to={row.editHref} className="tap-area hover:underline focus-visible:underline">
                    {row.title}
                  </OriginLink>
                </p>
                <p className="mt-0.5 text-small text-pretty text-ink-muted">{row.detail}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <OriginLink to={row.viewHref} className={SMALL_BUTTON}>
                  View
                </OriginLink>
                {row.canPublish ? (
                  <button type="button" className={SMALL_BUTTON} disabled={model.busy} onClick={() => model.publish(row.id)}>
                    {row.status === 'HIDDEN' ? 'Publish again' : 'Publish'}
                  </button>
                ) : null}
                {row.canUnpublish ? (
                  <button type="button" className={SMALL_BUTTON} disabled={model.busy} onClick={() => model.unpublish(row.id)}>
                    Unpublish
                  </button>
                ) : null}
                <button
                  type="button"
                  className={cn(SMALL_BUTTON, 'text-caution')}
                  disabled={model.busy}
                  onClick={() => {
                    if (window.confirm(`Delete “${row.title}”? It is removed from your page.`)) {
                      model.remove(row.id);
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-body-lg text-pretty text-ink">{model.emptyText}</p>
      )}
    </>
  );
}
