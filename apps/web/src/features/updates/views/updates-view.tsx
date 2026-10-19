import { Megaphone, PenLine } from 'lucide-react';
import { Container } from '@/components/container';
import { SelectField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { cn } from '@/lib/utils';
import { OriginLink } from '@/navigation/origin-link';
import type { UpdateItem } from '../presenters/update-format';
import type { UpdatesModel } from '../presenters/use-updates';
import { UpdateSheet } from './update-sheet';

const TITLE_LINK =
  'tap-area rounded-sm text-ink underline decoration-transparent decoration-1 underline-offset-4 transition-colors duration-300 hover:decoration-ink focus-visible:decoration-ink';

/** The council an update is from, as a small outlined pill. */
export function CouncilChip({ acronym, className }: { acronym: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border border-leaf bg-white px-2.5 py-0.5 text-caption font-semibold text-ink',
        className,
      )}
    >
      {acronym}
    </span>
  );
}

function UpdateRow({ item }: { item: UpdateItem }) {
  return (
    <li className="grid gap-2 border-t border-border py-6 first:border-t-0 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-8">
      <div className="flex items-center gap-3 md:flex-col md:items-start md:gap-2">
        <time
          dateTime={item.publishedAt}
          className="text-small font-semibold text-ink tabular-nums"
        >
          {item.published}
        </time>
        <CouncilChip acronym={item.council.acronym} />
      </div>
      <article className="min-w-0">
        <h2 className="text-h3 font-bold text-balance">
          <OriginLink to={item.href} className={TITLE_LINK}>
            {item.title}
          </OriginLink>
        </h2>
        {item.excerpt ? (
          <p className="mt-2 max-w-prose text-body text-pretty text-ink-muted">{item.excerpt}</p>
        ) : null}
        {item.edited ? <p className="mt-2 text-caption text-ink-muted">{item.edited}</p> : null}
      </article>
    </li>
  );
}

/** /updates: news from the ISSC and the Collegiate Student Councils, newest first. */
export function UpdatesView({ model }: { model: UpdatesModel }) {
  const filtered = model.filter.value !== '';
  const filterLabel = model.filter.options.find((o) => o.value === model.filter.value)?.label;

  return (
    <div className="bg-surface-sweep min-h-page">
      <title>Updates | Orghive</title>
      <Container as="main" className="max-w-4xl pt-4 pb-section lg:pt-6">
        <div className="mt-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <h1 className="text-h1 font-bold text-ink">Updates</h1>
            <p className="mt-2 max-w-prose text-body text-ink-muted">
              Announcements from the ISSC and the Collegiate Student Councils.
            </p>
          </div>
          {model.composer ? (
            <PillButton size="md" onClick={() => model.composer!.setOpen(true)}>
              <PenLine aria-hidden="true" />
              Post an update
            </PillButton>
          ) : null}
        </div>

        <div className="mt-6 max-w-xs">
          <SelectField
            label="From"
            placeholder="All councils"
            options={model.filter.options}
            value={model.filter.value}
            onChange={(event) => model.filter.set(event.target.value)}
          />
        </div>

        <section
          aria-label="Updates"
          className="mt-6 rounded-2xl bg-white px-5 shadow-pool ring-1 ring-ink/10 md:px-8"
        >
          {model.status === 'loading' ? (
            <div aria-busy="true" className="flex flex-col gap-6 py-6">
              <span className="sr-only">Loading the updates</span>
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="grid gap-2 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-8">
                  <Skeleton className="h-5 w-28 rounded-full" />
                  <div className="space-y-2">
                    <Skeleton className="h-7 w-3/4 rounded-full" />
                    <Skeleton className="h-4 w-full rounded-full" />
                    <Skeleton className="h-4 w-2/3 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : model.status === 'error' ? (
            <div className="py-6">
              <SectionError
                message="The updates could not be loaded. Check your connection and try again."
                onRetry={model.retry}
              />
            </div>
          ) : model.items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Megaphone aria-hidden="true" className="size-8 text-ink-muted" />
              <p className="text-body-lg font-semibold text-ink">
                {filtered
                  ? `No updates from ${filterLabel ?? 'this council'} yet`
                  : 'No updates yet'}
              </p>
              <p className="max-w-prose text-body text-ink-muted">
                {filtered
                  ? 'Choose "All councils" to see every update.'
                  : 'When the ISSC or a Collegiate Student Council posts an update, it appears here.'}
              </p>
            </div>
          ) : (
            <ol>
              {model.items.map((item) => (
                <UpdateRow key={item.id} item={item} />
              ))}
            </ol>
          )}
        </section>

        {model.status === 'ready' && model.more ? (
          <div className="mt-6 flex justify-center">
            <PillButton
              variant="light"
              size="md"
              disabled={model.more.loading}
              onClick={model.more.load}
            >
              {model.more.loading ? 'Loading…' : 'Show older updates'}
            </PillButton>
          </div>
        ) : null}
      </Container>

      {model.composer ? (
        <UpdateSheet
          mode="post"
          open={model.composer.open}
          onOpenChange={model.composer.setOpen}
          councils={model.composer.councils}
          onSave={model.composer.publish}
        />
      ) : null}
    </div>
  );
}
