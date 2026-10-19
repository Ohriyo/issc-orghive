import { AlertDialog, Dialog } from 'radix-ui';
import { PillButton } from '@/components/pill-button';
import { TextField } from '@/components/text-field';
import { FormAlert } from '@/features/auth/views/auth-layout';
import type { Confirming } from '../presenters/use-system-users';
import type { StepUpDialogModel } from '../presenters/use-step-up';

export const OVERLAY =
  'fixed inset-0 z-50 bg-ink/30 duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none';
export const PANEL =
  'fixed top-1/2 left-1/2 z-50 max-h-[85dvh] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 shadow-pool-lift duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none';
export const SECONDARY =
  'tap-area cursor-pointer rounded-sm text-body font-medium text-ink underline decoration-transparent underline-offset-4 transition-colors hover:decoration-ink focus-visible:decoration-ink';

/** Asks before a change to someone's account. */
export function ConfirmDialog({
  confirming,
  onCancel,
}: {
  confirming: Confirming | null;
  onCancel: () => void;
}) {
  return (
    <AlertDialog.Root open={confirming !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={OVERLAY} />
        <AlertDialog.Content className={PANEL}>
          <AlertDialog.Title className="text-h3 font-bold text-ink">
            {confirming?.title}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-body text-ink">
            {confirming?.body}
          </AlertDialog.Description>
          <div className="mt-6 flex flex-wrap items-center justify-end gap-x-6 gap-y-3">
            <AlertDialog.Cancel className={SECONDARY}>Cancel</AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <PillButton type="button" onClick={confirming?.run}>
                {confirming?.confirmLabel}
              </PillButton>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/** A fresh authenticator code before a destructive action; good for 5 minutes. */
export function StepUpDialog({
  open,
  register,
  errors,
  onSubmit,
  isSubmitting,
  formError,
  onCancel,
}: Omit<StepUpDialogModel, 'onSubmit'> & { onSubmit: () => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY} />
        <Dialog.Content className={PANEL}>
          <Dialog.Title className="text-h3 font-bold text-ink">Confirm it&rsquo;s you</Dialog.Title>
          <Dialog.Description className="mt-2 text-body text-ink">
            Enter the 6-digit code from your authenticator app. For the next 5 minutes, changes in
            the console will not ask again.
          </Dialog.Description>
          <form noValidate onSubmit={onSubmit} className="mt-5 flex flex-col gap-5">
            <FormAlert message={formError} />
            <TextField
              label="Authentication code"
              autoComplete="one-time-code"
              inputMode="numeric"
              placeholder="123456"
              autoFocus
              error={errors.code?.message}
              {...register('code')}
            />
            <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-3">
              <Dialog.Close className={SECONDARY}>Cancel</Dialog.Close>
              <PillButton type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Checking…' : 'Confirm'}
              </PillButton>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
