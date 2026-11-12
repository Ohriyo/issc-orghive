import { Mail, Trash2 } from 'lucide-react';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { TextField } from '@/components/text-field';
import { cn } from '@/lib/utils';
import type { CacheToolsModel } from '../presenters/use-cache-tools';
import type { EmailTestModel } from '../presenters/use-email-test';
import { ConfirmDialog, StepUpDialog } from './system-dialogs';
import { SystemLoading } from './system-layout';

const PANEL = 'rounded-xl bg-white ring-1 ring-border';

/** /system/tools: the cache by namespace, and a test email. */
export function ToolsView({ cache, email }: { cache: CacheToolsModel; email: EmailTestModel }) {
  return (
    <div className="flex flex-col gap-10">
      <CacheSection model={cache} />
      <EmailSection model={email} />
    </div>
  );
}

function CacheSection({ model }: { model: CacheToolsModel }) {
  return (
    <section aria-labelledby="cache-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="cache-heading" className="text-h3 font-bold text-ink">
          Cache
        </h2>
        <p className="max-w-prose text-small text-ink-muted">
          Cached public reads, by kind. Flush one when a page shows something stale; the next visit
          loads it from the database. Sessions, rate limits and queues are not cache and are never
          flushed from here.
        </p>
      </div>
      {model.status === 'loading' ? (
        <SystemLoading label="Loading the cache" />
      ) : model.status === 'error' ? (
        <SectionError
          message="The cache could not be read. The API may not reach Redis."
          onRetry={model.retry}
        />
      ) : (
        <>
          <ul className={cn(PANEL, 'divide-y divide-border')}>
            {model.namespaces.map((namespace) => (
              <li
                key={namespace.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-body font-semibold text-ink">
                    {namespace.label}{' '}
                    <span className="font-normal text-ink-muted tabular-nums">
                      · {namespace.keys} {namespace.keys === '1' ? 'entry' : 'entries'}
                    </span>
                  </p>
                  <p className="text-small text-ink-muted">{namespace.description}</p>
                </div>
                <PillButton
                  variant="light"
                  className="shrink-0 self-start sm:self-auto"
                  onClick={() => model.askFlush(namespace.id)}
                  disabled={namespace.empty || model.flushing === namespace.id}
                  aria-label={`Flush ${namespace.label}`}
                >
                  <Trash2 aria-hidden="true" />
                  {model.flushing === namespace.id ? 'Flushing…' : 'Flush'}
                </PillButton>
              </li>
            ))}
          </ul>
          <p className="text-small text-ink-muted">
            {model.whole ? `${model.whole}. ` : ''}As of {model.generatedAt}, Manila time.
          </p>
          <ConfirmDialog confirming={model.confirming} onCancel={model.cancelConfirm} />
          <StepUpDialog {...model.stepUp} />
        </>
      )}
    </section>
  );
}

function EmailSection({ model }: { model: EmailTestModel }) {
  return (
    <section aria-labelledby="email-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="email-heading" className="text-h3 font-bold text-ink">
          Test email
        </h2>
        <p className="max-w-prose text-small text-ink-muted">
          Sends one message straight through the mail relay, not the notification queue, so you see
          at once whether outgoing email works.
        </p>
      </div>
      <form
        noValidate
        onSubmit={model.submit}
        className={cn(PANEL, 'flex flex-col gap-4 p-5 sm:flex-row sm:items-start')}
      >
        <TextField
          label="Send to"
          type="email"
          autoComplete="email"
          className="min-w-0 sm:max-w-sm sm:flex-1"
          hint="Leave blank to send it to your own address."
          maxLength={254}
          value={model.to}
          error={model.fieldError ?? undefined}
          onChange={(event) => model.setTo(event.target.value)}
        />
        <PillButton type="submit" className="shrink-0 self-start sm:mt-8" disabled={model.sending}>
          <Mail aria-hidden="true" />
          {model.sending ? 'Sending…' : 'Send test email'}
        </PillButton>
      </form>
      <div aria-live="polite">
        {model.result ? (
          <p
            role={model.result.tone === 'error' ? 'alert' : undefined}
            className={cn(
              'rounded-xl px-5 py-3 text-body break-words',
              model.result.tone === 'success'
                ? 'bg-white text-ink ring-1 ring-border'
                : 'bg-destructive/8 text-destructive',
            )}
          >
            {model.result.message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
