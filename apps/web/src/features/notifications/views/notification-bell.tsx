import { Bell } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { cn } from '@/lib/utils';
import { OriginLink } from '@/navigation/origin-link';
import type { NotificationsModel } from '../presenters/use-notifications';

const FOOTER_LINK =
  'flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-full px-3 text-small font-semibold text-ink outline-none select-none data-[highlighted]:bg-surface';

const ITEM =
  'flex cursor-pointer flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left outline-none select-none data-[highlighted]:bg-surface';

/**
 * The header bell: unread count on the button, the latest notifications in a menu (Radix:
 * arrow keys, Esc, focus return). Choosing one opens its page and marks it read. The full
 * list and the email settings are a link away at the bottom.
 */
export function NotificationBell({
  model,
  className,
}: {
  model: NotificationsModel;
  className?: string;
}) {
  if (model.status === 'off') return null;
  const unread = model.status === 'ready' ? model.unreadCount : 0;
  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        aria-label={label}
        className={cn(
          'relative grid size-11 shrink-0 cursor-pointer place-items-center rounded-full bg-white/80 text-ink shadow-pool ring-1 ring-ink/10 transition-colors duration-300 hover:bg-white focus-visible:bg-white data-[state=open]:bg-white motion-reduce:transition-none',
          className,
        )}
      >
        <Bell aria-hidden="true" className="size-5" />
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-destructive px-1 text-caption leading-none font-bold text-white"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className="z-50 flex max-h-[70dvh] w-96 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-pool-lift ring-1 ring-ink/10 duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
            <DropdownMenu.Label className="text-body font-semibold text-ink">
              Notifications
            </DropdownMenu.Label>
            {model.status === 'ready' && unread > 0 ? (
              <DropdownMenu.Item
                onSelect={(event) => {
                  event.preventDefault();
                  model.markAllRead();
                }}
                className="flex min-h-11 cursor-pointer items-center rounded-full px-3 text-small font-medium text-ink outline-none data-[highlighted]:bg-surface"
              >
                Mark all read
              </DropdownMenu.Item>
            ) : null}
          </div>
          <div className="overflow-y-auto p-2">
            {model.status === 'loading' ? (
              <p className="px-3 py-4 text-small text-ink-muted">Loading…</p>
            ) : model.status === 'error' ? (
              <DropdownMenu.Item
                onSelect={(event) => {
                  event.preventDefault();
                  model.retry();
                }}
                className={ITEM}
              >
                <span className="text-small text-ink">Notifications could not be loaded.</span>
                <span className="text-small font-semibold text-ink underline">Try again</span>
              </DropdownMenu.Item>
            ) : model.items.length === 0 ? (
              <p className="px-3 py-4 text-small text-ink-muted">
                Nothing yet. Deadlines, appeals and updates from your council show up here.
              </p>
            ) : (
              model.items.map((item) => (
                <DropdownMenu.Item key={item.id} onSelect={item.open} className={ITEM}>
                  <span className="flex items-start gap-2">
                    {item.unread ? (
                      <span className="mt-2 size-2 shrink-0 rounded-full bg-destructive">
                        <span className="sr-only">Unread: </span>
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        'text-small break-words text-ink',
                        item.unread ? 'font-semibold' : 'font-medium',
                      )}
                    >
                      {item.title}
                    </span>
                  </span>
                  <span className="line-clamp-3 text-small break-words text-ink-muted">
                    {item.body}
                  </span>
                  <span className="text-caption text-ink-muted">{item.when}</span>
                </DropdownMenu.Item>
              ))
            )}
          </div>
          <div className="flex gap-1 border-t border-border p-1.5">
            <DropdownMenu.Item asChild className={FOOTER_LINK}>
              <OriginLink to="/dashboard/notifications">See all</OriginLink>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild className={FOOTER_LINK}>
              <OriginLink to="/dashboard/notifications/settings">Email settings</OriginLink>
            </DropdownMenu.Item>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
