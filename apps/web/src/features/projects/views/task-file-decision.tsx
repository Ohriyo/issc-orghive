import { Dialog } from 'radix-ui';
import { FLAG_REASON_MAX_LENGTH } from '@orghive/shared';
import { ActingAsField } from '@/components/acting-as-field';
import { TextAreaField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { FormAlert } from '@/features/auth/views/auth-layout';
import { OVERLAY, PANEL, SECONDARY } from '@/features/system/views/system-dialogs';
import type { DecisionActions, TaskFileDecisionModel } from '../presenters/use-task-file-decision';

/** "Clear warning" and "Flag invalid" on one task file, for its governing bodies. */
export function DecisionButtons({ actions, name }: { actions: DecisionActions; name: string }) {
  if (!actions.clear && !actions.flag) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {actions.clear ? (
        <PillButton variant="light" onClick={actions.clear} className="max-sm:w-full">
          Clear warning
          <span className="sr-only">: {name}</span>
        </PillButton>
      ) : null}
      {actions.flag ? (
        <PillButton variant="light" onClick={actions.flag} className="max-sm:w-full">
          Flag invalid
          <span className="sr-only">: {name}</span>
        </PillButton>
      ) : null}
    </div>
  );
}

const COPY = {
  clear: {
    title: 'Clear the warning',
    description:
      'You looked at this file and its warnings do not matter: it counts as verified for the leaderboard. The organization is told.',
    submit: 'Clear warning',
  },
  flag: {
    title: 'Flag as invalid',
    description:
      'The file stays where it is and still completes the task, but no longer counts for the leaderboard until the organization uploads a corrected one. They see your reason.',
    submit: 'Flag invalid',
  },
} as const;

/** The dialog both actions open: what is decided, why, and who acts for the council. */
export function TaskFileDecisionDialog({ model }: { model: TaskFileDecisionModel }) {
  const open = model.open;
  const copy = open ? COPY[open.mode] : COPY.clear;
  return (
    <Dialog.Root open={open !== null} onOpenChange={(next) => (next ? null : model.close())}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY} />
        <Dialog.Content className={PANEL}>
          <Dialog.Title className="text-h3 font-bold text-ink">{copy.title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-body text-ink">
            {copy.description}
          </Dialog.Description>
          {open ? (
            <form
              noValidate
              className="mt-6 flex flex-col gap-5"
              onSubmit={(event) => {
                event.preventDefault();
                model.submit();
              }}
            >
              <div className="rounded-xl bg-surface p-3 text-small text-ink">
                <p className="font-semibold break-words">{open.target.name}</p>
                {open.target.reasons.length > 0 ? (
                  <ul className="mt-1 ml-5 list-disc">
                    {open.target.reasons.map((reason) => (
                      <li key={reason} className="break-words">
                        {reason}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <FormAlert message={model.error ?? undefined} />
              {open.mode === 'flag' ? (
                <TextAreaField
                  label="Why it is invalid"
                  hint="The organization sees this. Say what to fix."
                  rows={3}
                  maxLength={FLAG_REASON_MAX_LENGTH}
                  value={model.reason.value}
                  error={model.reason.error}
                  disabled={model.saving}
                  onChange={(event) => model.reason.onChange(event.target.value)}
                />
              ) : (
                <TextAreaField
                  label="Note (optional)"
                  hint="Why the warning does not matter. The organization sees this."
                  rows={2}
                  maxLength={FLAG_REASON_MAX_LENGTH}
                  value={model.note.value}
                  error={model.note.error}
                  disabled={model.saving}
                  onChange={(event) => model.note.onChange(event.target.value)}
                />
              )}
              <ActingAsField
                orgAcronym={model.orgAcronym}
                savedWith="the decision"
                value={model.actingAs.value}
                error={model.actingAs.error}
                onChange={(event) => model.actingAs.onChange(event.target.value)}
                disabled={model.saving}
              />
              <div className="mt-2 flex flex-wrap items-center justify-end gap-6">
                <Dialog.Close className={SECONDARY}>Cancel</Dialog.Close>
                <PillButton type="submit" disabled={model.saving}>
                  {model.saving ? 'Saving…' : copy.submit}
                </PillButton>
              </div>
            </form>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
