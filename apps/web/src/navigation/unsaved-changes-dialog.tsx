import { AlertDialog } from 'radix-ui';
import { PillButton } from '@/components/pill-button';

export interface ConfirmLeaveDialogProps {
  open: boolean;
  /** Keep editing. */
  onStay: () => void;
  /** Throw the changes away and go. */
  onLeave: () => void;
  title?: string;
  description?: string;
}

/**
 * "Leave without saving?" Focus starts on Stay, the safe choice; Esc also stays.
 * Used for route changes (with useUnsavedChangesGuard) and for closing an edit dialog.
 */
export function ConfirmLeaveDialog({
  open,
  onStay,
  onLeave,
  title = 'Leave without saving?',
  description = 'Your changes on this page have not been saved. If you leave now they will be lost.',
}: ConfirmLeaveDialogProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => (next ? undefined : onStay())}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-ink/40 duration-300 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-[60] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-white p-6 shadow-pool-lift duration-300 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none md:p-8">
          <AlertDialog.Title className="text-h3 font-bold text-ink">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-body text-ink-muted">
            {description}
          </AlertDialog.Description>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <AlertDialog.Action asChild>
              <PillButton variant="light" size="md" onClick={onLeave}>
                Leave
              </PillButton>
            </AlertDialog.Action>
            <AlertDialog.Cancel asChild>
              <PillButton size="md" onClick={onStay}>
                Stay on this page
              </PillButton>
            </AlertDialog.Cancel>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
