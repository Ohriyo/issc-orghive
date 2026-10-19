import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  createAnnouncementRequestSchema,
  type CreateAnnouncementRequest,
} from '@orghive/shared';
import { SelectField, TextAreaField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { TextField } from '@/components/text-field';
import { ConfirmLeaveDialog } from '@/navigation/unsaved-changes-dialog';
import { useUnsavedChangesGuard } from '@/navigation/use-unsaved-changes';
import type { PostingCouncil } from '../presenters/use-updates';

const formSchema = createAnnouncementRequestSchema.extend({
  council: z.string().min(1, 'Choose the council this update is from'),
});
type UpdateForm = z.infer<typeof formSchema>;

export interface UpdateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'post' | 'edit';
  /** Post: the councils the officer may post for. Edit: the update's own council only. */
  councils: PostingCouncil[];
  initial?: { title: string; body: string };
  /** Returns an error message, or null once saved (the owner then closes the sheet). */
  onSave: (council: string, values: CreateAnnouncementRequest) => Promise<string | null>;
}

/**
 * The form for posting or editing an update. A side sheet from md, a bottom sheet on phones;
 * closing with unsaved text asks first. Plain text only: blank lines separate paragraphs.
 */
export function UpdateSheet({
  open,
  onOpenChange,
  mode,
  councils,
  initial,
  onSave,
}: UpdateSheetProps) {
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const guard = useUnsavedChangesGuard(open && dirty);
  const close = () => {
    setDirty(false);
    onOpenChange(false);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else if (dirty) setConfirmClose(true);
        else close();
      }}
    >
      <ConfirmLeaveDialog
        open={confirmClose || guard.blocker.state === 'blocked'}
        title="Discard this update?"
        description="What you wrote has not been saved."
        leaveLabel="Discard"
        stayLabel="Keep writing"
        onStay={() => {
          setConfirmClose(false);
          guard.blocker.reset?.();
        }}
        onLeave={() => {
          setConfirmClose(false);
          close();
          guard.blocker.proceed?.();
        }}
      />
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/30 duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto overscroll-contain rounded-t-2xl bg-white px-gutter pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] shadow-pool-lift duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[min(36rem,100vw)] md:rounded-none md:p-8 md:data-[state=closed]:slide-out-to-right md:data-[state=open]:slide-in-from-right">
          <div
            aria-hidden="true"
            className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-surface-deep md:hidden"
          />
          {open ? (
            <SheetForm
              mode={mode}
              councils={councils}
              initial={initial}
              onSave={onSave}
              onDirty={() => setDirty(true)}
              onSaved={() => {
                setDirty(false);
                guard.allowNextNavigation();
              }}
            />
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SheetForm({
  mode,
  councils,
  initial,
  onSave,
  onDirty,
  onSaved,
}: Pick<UpdateSheetProps, 'mode' | 'councils' | 'initial' | 'onSave'> & {
  onDirty: () => void;
  onSaved: () => void;
}) {
  const [saveError, setSaveError] = useState<string>();
  const form = useForm<UpdateForm>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      council: councils.length === 1 ? councils[0]!.slug : '',
      title: initial?.title ?? '',
      body: initial?.body ?? '',
    },
  });
  const errors = form.formState.errors;
  const submit = form.handleSubmit(async ({ council, title, body }) => {
    setSaveError(undefined);
    const error = await onSave(council, { title, body });
    if (error) setSaveError(error);
    else onSaved();
  });
  const only = councils.length === 1 ? councils[0] : undefined;

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <Dialog.Title className="text-h3 font-bold text-ink">
          {mode === 'post' ? 'Post an update' : 'Edit update'}
        </Dialog.Title>
        <Dialog.Close
          aria-label="Close"
          className="-mt-1.5 -mr-2 grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink transition-colors duration-300 hover:bg-surface focus-visible:bg-surface"
        >
          <X aria-hidden="true" className="size-6" />
        </Dialog.Close>
      </div>
      <Dialog.Description className="mt-1 text-body text-ink-muted">
        {mode === 'post'
          ? `It is published at once, and anyone can read it${only ? ` as an update from ${only.acronym}` : ''}.`
          : 'Changes show at once, marked as edited.'}
      </Dialog.Description>
      <form
        noValidate
        className="mt-6 grid gap-5"
        onChange={onDirty}
        onSubmit={(event) => void submit(event)}
      >
        {mode === 'post' && councils.length > 1 ? (
          <SelectField
            label="From"
            placeholder="Choose a council"
            options={councils.map((c) => ({ value: c.slug, label: c.acronym }))}
            error={errors.council?.message}
            {...form.register('council')}
          />
        ) : null}
        <TextField
          label="Title"
          maxLength={ANNOUNCEMENT_TITLE_MAX}
          error={errors.title?.message}
          {...form.register('title')}
        />
        <TextAreaField
          label="Update"
          rows={10}
          maxLength={ANNOUNCEMENT_BODY_MAX}
          hint="Plain text. Leave a blank line between paragraphs."
          error={errors.body?.message}
          {...form.register('body')}
        />
        {saveError ? (
          <p role="alert" className="text-body font-medium text-destructive">
            {saveError}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap justify-end gap-3">
          <Dialog.Close asChild>
            <PillButton type="button" variant="light" size="md">
              Cancel
            </PillButton>
          </Dialog.Close>
          <PillButton type="submit" size="md" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Saving…' : mode === 'post' ? 'Publish' : 'Save changes'}
          </PillButton>
        </div>
      </form>
    </>
  );
}
