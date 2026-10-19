import { BellOff, CheckCheck, Eye, Settings } from 'lucide-react';
import { Container } from '@/components/container';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { cn } from '@/lib/utils';
import { OriginLink } from '@/navigation/origin-link';
import type {
  CenterItem,
  NotificationCenterModel,
  NotificationShow,
} from '../presenters/use-notification-center';
import { RevealDialog } from './reveal-dialog';

const TABS: { key: NotificationShow; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
];

const TEXT_BUTTON =
  'tap-area cursor-pointer rounded-sm text-small font-semibold text-ink underline decoration-transparent decoration-1 underline-offset-4 transition-colors duration-300 hover:decoration-ink focus-visible:decoration-ink';

function Row({ item }: { item: CenterItem }) {
  return (
    <li
      className={cn(
        'flex gap-3 border-t border-border px-5 py-4 first:border-t-0 md:px-6',
        item.unread && 'bg-surface/70',
      )}
    >
      <span aria-hidden="true" className="mt-2 w-2 shrink-0">
        {item.unread ? <span className="block size-2 rounded-full bg-destructive" /> : null}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-caption text-ink-muted">
          <span className="font-semibold uppercase tracking-wide">{item.kindLabel}</span>
          <time dateTime={item.createdAt} title={item.at}>
            {item.when}
          </time>
          {item.unread ? <span className="sr-only">Unread</span> : null}
        </p>
        <h2
          className={cn(
            'mt-1 text-body break-words text-ink',
            item.unread ? 'font-bold' : 'font-medium',
          )}
        >
          {item.href ? (
            <button
              type="button"
              onClick={item.open}
              className="tap-area cursor-pointer rounded-sm text-left underline decoration-transparent decoration-1 underline-offset-4 transition-colors duration-300 hover:decoration-ink focus-visible:decoration-ink"
            >
              {item.title}
            </button>
          ) : (
            item.title
          )}
        </h2>
        <p className="mt-1 max-w-prose text-small break-words text-ink-muted">{item.body}</p>
        {item.openReveal ? (
          <PillButton variant="light" size="md" className="mt-3" onClick={item.openReveal}>
            <Eye aria-hidden="true" />
            Reveal
          </PillButton>
        ) : null}
        {item.unread ? (
          <button
            type="button"
            onClick={item.markRead}
            className={cn(TEXT_BUTTON, 'mt-2')}
            aria-label={`Mark "${item.title}" read`}
          >
            Mark read
          </button>
        ) : null}
      </div>
    </li>
  );
}

/** /dashboard/notifications: the notification center. */
export function NotificationCenterView({ model }: { model: NotificationCenterModel }) {
  const unread = model.status === 'ready' ? model.unreadCount : 0;
  return (
    <div className="bg-surface-sweep min-h-page">
      <title>Notifications | Orghive</title>
      <Container as="main" className="max-w-3xl pt-4 pb-section lg:pt-6">
        <div className="mt-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-h1 font-bold text-ink">Notifications</h1>
            <p className="mt-2 max-w-prose text-body text-ink-muted">
              {model.status === 'ready'
                ? unread === 0
                  ? 'You are all caught up.'
                  : `${unread} unread.`
                : 'Deadlines, appeals, files, terms and updates from your council.'}
            </p>
          </div>
          <OriginLink
            to="/dashboard/notifications/settings"
            className="tap-area inline-flex items-center gap-2 rounded-sm text-body font-semibold text-ink underline decoration-ink/30 decoration-1 underline-offset-4 transition-colors duration-300 hover:decoration-ink focus-visible:decoration-ink"
          >
            <Settings aria-hidden="true" className="size-4" />
            Email settings
          </OriginLink>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div
            role="group"
            aria-label="Show"
            className="inline-flex rounded-full bg-white p-1 shadow-pool ring-1 ring-ink/10"
          >
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                aria-pressed={model.show === tab.key}
                onClick={() => model.setShow(tab.key)}
                className={cn(
                  'min-h-11 cursor-pointer rounded-full px-5 text-body font-medium whitespace-nowrap text-ink transition-colors duration-300 motion-reduce:transition-none',
                  model.show === tab.key
                    ? 'bg-ink text-white'
                    : 'hover:bg-surface focus-visible:bg-surface',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {model.status === 'ready' && unread > 0 ? (
            <PillButton variant="light" size="md" onClick={model.markAllRead}>
              <CheckCheck aria-hidden="true" />
              Mark all read
            </PillButton>
          ) : null}
        </div>

        <section
          aria-label="Notifications"
          className="mt-6 overflow-hidden rounded-2xl bg-white shadow-pool ring-1 ring-ink/10"
        >
          {model.status === 'loading' ? (
            <div aria-busy="true" className="flex flex-col gap-4 p-5 md:p-6">
              <span className="sr-only">Loading notifications</span>
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-40 rounded-full" />
                  <Skeleton className="h-5 w-3/4 rounded-full" />
                  <Skeleton className="h-4 w-full rounded-full" />
                </div>
              ))}
            </div>
          ) : model.status === 'error' ? (
            <div className="p-5 md:p-6">
              <SectionError
                message="Your notifications could not be loaded. Check your connection and try again."
                onRetry={model.retry}
              />
            </div>
          ) : model.items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <BellOff aria-hidden="true" className="size-8 text-ink-muted" />
              <p className="text-body-lg font-semibold text-ink">
                {model.show === 'unread' ? 'Nothing unread' : 'No notifications yet'}
              </p>
              <p className="max-w-prose text-body text-ink-muted">
                {model.show === 'unread'
                  ? 'Everything here has been read.'
                  : 'Deadline reminders, appeal decisions and updates from your council appear here.'}
              </p>
            </div>
          ) : (
            <ul>
              {model.items.map((item) => (
                <Row key={item.id} item={item} />
              ))}
            </ul>
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
              {model.more.loading ? 'Loading…' : 'Show older'}
            </PillButton>
          </div>
        ) : null}
      </Container>
      <RevealDialog state={model.reveal} onClose={model.closeReveal} />
    </div>
  );
}
