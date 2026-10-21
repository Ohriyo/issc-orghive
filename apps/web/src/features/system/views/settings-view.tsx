import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { TextField } from '@/components/text-field';
import { FormAlert } from '@/features/auth/views/auth-layout';
import type { SystemSettingsModel } from '../presenters/use-system-settings';

const PANEL = 'rounded-xl bg-white p-5 ring-1 ring-border md:p-6';

/** /system/settings: the leaderboard's late value (spec 5C). */
export function SettingsView({ model }: { model: SystemSettingsModel }) {
  if (model.status === 'loading') {
    return (
      <div aria-busy="true" className={PANEL}>
        <p className="sr-only">Loading the settings</p>
        <Skeleton className="h-6 w-56" />
        <Skeleton className="mt-4 h-12 w-40" />
      </div>
    );
  }
  if (model.status === 'error') {
    return (
      <SectionError
        message="The settings could not be loaded. Check your connection and try again."
        onRetry={model.retry}
      />
    );
  }
  return (
    <section aria-labelledby="late-points-heading" className={PANEL}>
      <h2 id="late-points-heading" className="text-h3 font-bold text-ink">
        Leaderboard: points for a late project
      </h2>
      <p className="mt-2 max-w-prose text-body text-ink">
        An implemented project earns 1 point when every report was on time, and this many when
        any was late. Saving recomputes the current and the previous semester; older semesters
        keep their standings. Every change is recorded in the audit log.
      </p>
      <form
        noValidate
        className="mt-5 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          model.save();
        }}
      >
        <FormAlert message={model.error ?? undefined} />
        <div className="flex flex-wrap items-end gap-4">
          <TextField
            label="Points for a late project (0 to 1)"
            hint={model.lastChange}
            inputMode="decimal"
            autoComplete="off"
            className="w-full max-w-xs"
            value={model.latePoints}
            onChange={(event) => model.setLatePoints(event.target.value)}
            disabled={model.saving}
          />
          <PillButton type="submit" disabled={model.saving || !model.dirty}>
            {model.saving ? 'Saving…' : 'Save'}
          </PillButton>
        </div>
        <p aria-live="polite" className="text-small text-ink-muted">
          {model.saved
            ? 'Saved. The leaderboards are being recomputed.'
            : model.preview
              ? `A late project would earn ${model.preview}.`
              : null}
        </p>
      </form>
    </section>
  );
}
