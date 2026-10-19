import { useId } from 'react';
import { Container } from '@/components/container';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { ToggleSwitch } from '@/components/toggle-switch';
import type {
  NotificationSettingsModel,
  SettingRow,
} from '../presenters/use-notification-settings';

function Setting({ row }: { row: SettingRow }) {
  const id = useId();
  return (
    <li className="flex items-center justify-between gap-6 border-t border-border py-4 first:border-t-0">
      <div className="min-w-0">
        <p id={`${id}-label`} className="text-body font-medium text-ink">
          {row.label}
        </p>
        <p id={`${id}-hint`} className="mt-0.5 text-small text-ink-muted">
          {row.hint}
        </p>
      </div>
      <span className="flex shrink-0 items-center gap-3">
        <span aria-hidden="true" className="w-6 text-right text-small text-ink-muted">
          {row.email ? 'On' : 'Off'}
        </span>
        <ToggleSwitch
          checked={row.email}
          onCheckedChange={row.toggle}
          labelledBy={`${id}-label`}
          describedBy={`${id}-hint`}
        />
      </span>
    </li>
  );
}

/** /dashboard/notifications/settings: which notifications also come by email. */
export function NotificationSettingsView({ model }: { model: NotificationSettingsModel }) {
  return (
    <div className="bg-surface-sweep min-h-page">
      <title>Email settings | Orghive</title>
      <Container as="main" className="max-w-3xl pt-4 pb-section lg:pt-6">
        <div className="mt-6">
          <h1 className="text-h1 font-bold text-ink">Email settings</h1>
          <p className="mt-2 max-w-prose text-body text-ink-muted">
            Notifications always appear in Orghive. Choose which ones also come by email
            {model.status === 'ready' && model.email ? (
              <>
                {' '}
                to <span className="font-semibold break-all text-ink">{model.email}</span>
              </>
            ) : null}
            . Each switch saves at once.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-6">
          {model.status === 'loading' ? (
            <div aria-busy="true" className="flex flex-col gap-6">
              <span className="sr-only">Loading your email settings</span>
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-40 w-full rounded-2xl" />
              ))}
            </div>
          ) : model.status === 'error' ? (
            <SectionError
              message="Your email settings could not be loaded. Check your connection and try again."
              onRetry={model.retry}
            />
          ) : (
            model.groups.map((group) => (
              <section
                key={group.title}
                aria-label={group.title}
                className="rounded-2xl bg-white px-5 py-2 shadow-pool ring-1 ring-ink/10 md:px-6"
              >
                <h2 className="pt-4 text-small font-semibold tracking-wide text-ink-muted uppercase">
                  {group.title}
                </h2>
                <ul className="mt-1">
                  {group.rows.map((row) => (
                    <Setting key={row.kind} row={row} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </Container>
    </div>
  );
}
