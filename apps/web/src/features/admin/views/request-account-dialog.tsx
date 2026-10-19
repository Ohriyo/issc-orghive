import { Dialog } from 'radix-ui';
import { TextAreaField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { TextField } from '@/components/text-field';
import { FormAlert } from '@/features/auth/views/auth-layout';
import type { AdminOrganizationsState } from '../presenters/use-admin-organizations';

type Dialogs = Extract<AdminOrganizationsState, { status: 'ready' }>['requestDialog'];

const OVERLAY =
  'fixed inset-0 z-50 bg-ink/30 duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none';
const PANEL =
  'fixed top-1/2 left-1/2 z-50 max-h-[85dvh] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 shadow-pool-lift duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none';
const SECONDARY =
  'tap-area cursor-pointer rounded-sm text-body font-medium text-ink underline decoration-transparent underline-offset-4 transition-colors hover:decoration-ink focus-visible:decoration-ink';

/** The ISSC asks the super admin for an organization's shared account. */
export function RequestAccountDialog({ dialog }: { dialog: Dialogs }) {
  const errors = dialog.errors;
  return (
    <Dialog.Root open={dialog.open} onOpenChange={(open) => !open && dialog.onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY} />
        <Dialog.Content className={PANEL}>
          <Dialog.Title className="text-h3 font-bold text-ink">
            Request an account for {dialog.organization}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-body text-ink">
            The super admin creates it. Its temporary password comes to your notifications, behind a
            one-time Reveal; hand it to the officer in charge.
          </Dialog.Description>
          <form
            noValidate
            onSubmit={(event) => void dialog.onSubmit(event)}
            className="mt-5 flex flex-col gap-5"
          >
            <FormAlert message={dialog.formError} />
            <TextField
              label="Account email"
              type="email"
              autoComplete="off"
              hint="The organization's shared address; its officers sign in with it."
              error={errors.accountEmail?.message}
              {...dialog.register('accountEmail')}
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                label="Officer in charge"
                autoComplete="off"
                error={errors.officerInCharge?.name?.message}
                {...dialog.register('officerInCharge.name')}
              />
              <TextField
                label="Position"
                placeholder="e.g. President"
                error={errors.officerInCharge?.position?.message}
                {...dialog.register('officerInCharge.position')}
              />
            </div>
            <TextField
              label="Officer’s contact email"
              type="email"
              autoComplete="off"
              error={errors.officerInCharge?.email?.message}
              {...dialog.register('officerInCharge.email')}
            />
            <TextAreaField
              label="Note for the super admin (optional)"
              rows={3}
              error={errors.note?.message}
              {...dialog.register('note')}
            />
            <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-3">
              <Dialog.Close className={SECONDARY}>Cancel</Dialog.Close>
              <PillButton type="submit" disabled={dialog.isSubmitting}>
                {dialog.isSubmitting ? 'Requesting…' : 'Request account'}
              </PillButton>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
