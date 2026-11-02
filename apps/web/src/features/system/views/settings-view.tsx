import { TextAreaField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { TextField } from '@/components/text-field';
import { FormAlert } from '@/features/auth/views/auth-layout';
import type {
  CheckSettingsModel,
  FinalAfterDaysModel,
  SystemSettingsModel,
} from '../presenters/use-system-settings';

const PANEL = 'rounded-xl bg-white p-5 ring-1 ring-border md:p-6';

/** The task file checks (spec section 6): what each task's file should say, and duplicates. */
function CheckSettings({ checks }: { checks: CheckSettingsModel }) {
  return (
    <section aria-labelledby="checks-heading" className={PANEL}>
      <h2 id="checks-heading" className="text-h3 font-bold text-ink">
        Task file checks
      </h2>
      <p className="mt-2 max-w-prose text-body text-ink">
        After the virus scan, every project task file is read for these words (in English or
        Filipino) and compared with every other task file. A missing word or a similar page only
        warns: the organization&apos;s CSC or the ISSC can clear it. New uploads use the new
        settings; files already checked keep their results. Every change is recorded in the audit
        log.
      </p>
      <form
        noValidate
        className="mt-5 flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          checks.save();
        }}
      >
        <FormAlert message={checks.error ?? undefined} />
        <TextField
          label="Similar pages: bits apart (0 to 16)"
          hint={`Two pages whose fingerprints differ by this many bits of 64 or fewer look like the same page. Lower means fewer warnings.`}
          inputMode="numeric"
          autoComplete="off"
          className="w-full max-w-md"
          value={checks.nearBits.value}
          error={checks.nearBits.error}
          onChange={(event) => checks.nearBits.onChange(event.target.value)}
          disabled={checks.saving}
        />
        <fieldset className="flex min-w-0 flex-col gap-3">
          <legend className="mb-1 text-body font-semibold text-ink">
            Words each file should contain
          </legend>
          <p className="text-small text-ink-muted">
            One phrase a line, up to 10. Separate alternatives with |, e.g. Attendance|Pagdalo. The
            project name and the organization&apos;s acronym are always looked for.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {checks.keywords.map((field) => (
              <TextAreaField
                key={field.type}
                label={field.label}
                rows={3}
                value={field.value}
                error={field.error}
                disabled={checks.saving}
                onChange={(event) => field.onChange(event.target.value)}
              />
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-4">
          <PillButton type="submit" disabled={checks.saving || !checks.dirty}>
            {checks.saving ? 'Saving…' : 'Save check settings'}
          </PillButton>
          <p aria-live="polite" className="text-small text-ink-muted">
            {checks.saved
              ? 'Saved. New uploads are checked with these settings.'
              : checks.lastChange}
          </p>
        </div>
      </form>
    </section>
  );
}

/** How long standings stay provisional after a semester's last day (spec 5B). */
function FinalAfterDays({ days }: { days: FinalAfterDaysModel }) {
  return (
    <section aria-labelledby="final-days-heading" className={PANEL}>
      <h2 id="final-days-heading" className="text-h3 font-bold text-ink">
        Leaderboard: when standings turn final
      </h2>
      <p className="mt-2 max-w-prose text-body text-ink">
        A semester&apos;s standings stay provisional for this many days after its last day, so late
        corrections still count. Then they are frozen as final. Changing this never reopens a
        semester that is already final. The ISSC account sets the semesters&apos; dates at Admin,
        Semesters.
      </p>
      <form
        noValidate
        className="mt-5 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          days.save();
        }}
      >
        <FormAlert message={days.error ?? undefined} />
        <div className="flex flex-wrap items-end gap-4">
          <TextField
            label="Days until final (0 to 60)"
            hint={days.lastChange}
            inputMode="numeric"
            autoComplete="off"
            className="w-full max-w-xs"
            value={days.value}
            onChange={(event) => days.onChange(event.target.value)}
            disabled={days.saving}
          />
          <PillButton type="submit" disabled={days.saving || !days.dirty}>
            {days.saving ? 'Saving…' : 'Save'}
          </PillButton>
        </div>
        <p aria-live="polite" className="text-small text-ink-muted empty:hidden">
          {days.saved
            ? 'Saved. Semesters past this many days turn final at the next recompute.'
            : null}
        </p>
      </form>
    </section>
  );
}

/** /system/settings: the leaderboard's late value (spec 5C) and the task file checks. */
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
    <div className="flex flex-col gap-6">
      <section aria-labelledby="late-points-heading" className={PANEL}>
        <h2 id="late-points-heading" className="text-h3 font-bold text-ink">
          Leaderboard: points for a late project
        </h2>
        <p className="mt-2 max-w-prose text-body text-ink">
          An implemented project earns 1 point when every report was on time, and this many when any
          was late. Saving recomputes the semesters still provisional; final ones keep their
          standings. Every change is recorded in the audit log.
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
      <FinalAfterDays days={model.finalAfterDays} />
      <CheckSettings checks={model.checks} />
    </div>
  );
}
