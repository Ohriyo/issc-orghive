import { RefreshCw } from 'lucide-react';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { RecoveryCodesPanel } from '@/features/auth/views/mfa-views';
import { cn } from '@/lib/utils';
import type { SystemSecurityModel } from '../presenters/use-system-security';
import { StepUpDialog } from './system-dialogs';
import { SystemLoading } from './system-layout';

/** /system/security: this session and this account's MFA, and new recovery codes. */
export function SecurityView({ model }: { model: SystemSecurityModel }) {
  const { state } = model;
  return (
    <div className="flex flex-col gap-8">
      {state.status === 'loading' ? (
        <SystemLoading label="Loading your security details" />
      ) : state.status === 'error' ? (
        <SectionError message="Your security details could not be loaded." onRetry={state.retry} />
      ) : (
        <dl className="divide-y divide-border rounded-xl bg-white ring-1 ring-border">
          {state.facts.map((fact) => (
            <div
              key={fact.label}
              className="grid gap-1 px-5 py-3 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-6"
            >
              <dt className="text-small font-medium text-ink-muted">{fact.label}</dt>
              <dd
                className={cn(
                  'text-body',
                  fact.attention ? 'font-semibold text-caution' : 'text-ink',
                )}
              >
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <section aria-labelledby="recovery-heading" className="flex max-w-2xl flex-col gap-4">
        <h2 id="recovery-heading" className="text-h3 font-bold text-ink">
          Recovery codes
        </h2>
        <p className="text-body text-ink">
          New codes replace every old one, used or not. You will be asked for an authenticator code
          first.
        </p>
        {model.recoveryCodes ? (
          <div role="status" className="flex flex-col gap-3">
            <p className="text-body font-medium text-ink">
              Save these now. They will not be shown again.
            </p>
            <RecoveryCodesPanel
              codes={model.recoveryCodes}
              copied={model.copied}
              onCopy={model.copyCodes}
              onDownload={model.downloadCodes}
            />
          </div>
        ) : (
          <PillButton
            variant="light"
            className="self-start"
            onClick={model.regenerate}
            disabled={model.isRegenerating}
          >
            <RefreshCw aria-hidden="true" />
            {model.isRegenerating ? 'Issuing…' : 'Issue new recovery codes'}
          </PillButton>
        )}
      </section>

      <StepUpDialog {...model.stepUp} />
    </div>
  );
}
