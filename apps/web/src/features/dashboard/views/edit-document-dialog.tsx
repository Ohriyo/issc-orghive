import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { Controller, useForm } from 'react-hook-form';
import {
  documentMetadataSchema,
  type DocumentMetadata,
  type DocumentSummary,
  type DocumentType,
} from '@orghive/shared';
import { SelectField, TextAreaField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { TextField } from '@/components/text-field';
import { ConfirmLeaveDialog } from '@/navigation/unsaved-changes-dialog';
import { useUnsavedChangesGuard } from '@/navigation/use-unsaved-changes';
import type { FilterOption } from '@/features/paperworks/presenters/use-paperworks';
import { tagsToText, textToTags } from '@/features/uploads/presenters/use-upload-documents';

export interface EditDocumentDialogProps {
  doc: DocumentSummary;
  types: DocumentType[];
  years: FilterOption[];
  semesters: FilterOption[];
  disabled: boolean;
  onSave: (values: DocumentMetadata) => Promise<string | undefined>;
}

function defaults(doc: DocumentSummary): DocumentMetadata {
  return {
    typeId: doc.type.id,
    title: doc.title,
    description: doc.description ?? undefined,
    academicYear: doc.academicYear,
    semester: doc.semester ?? undefined,
    visibility: doc.visibility,
    tags: doc.tags,
  };
}

/**
 * Edit a document's details, validated with the shared schema. Details can change at any
 * time before archiving: nothing is reviewed, so nothing needs approving again. Who can see
 * the document has its own control next to it.
 */
export function EditDocumentDialog({
  doc,
  types,
  years,
  semesters,
  disabled,
  onSave,
}: EditDocumentDialogProps) {
  const [open, setOpen] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const form = useForm<DocumentMetadata>({
    resolver: zodResolver(documentMetadataSchema),
    defaultValues: defaults(doc),
  });
  const errors = form.formState.errors;
  const dirty = open && form.formState.isDirty;
  // Leaving the page, or closing the dialog, with unsaved edits asks first.
  const guard = useUnsavedChangesGuard(dirty);
  const [confirmClose, setConfirmClose] = useState(false);

  const submit = form.handleSubmit(async (values) => {
    setSaveError(undefined);
    const error = await onSave(values);
    if (error) setSaveError(error);
    else {
      form.reset(values);
      setOpen(false);
    }
  });

  const asking = confirmClose || guard.blocker.state === 'blocked';

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && form.formState.isDirty) {
          setConfirmClose(true);
          return;
        }
        setOpen(next);
        if (next) {
          form.reset(defaults(doc));
          setSaveError(undefined);
        }
      }}
    >
      <ConfirmLeaveDialog
        open={asking}
        title="Discard your changes?"
        description="The changes you made to this document's details have not been saved."
        onStay={() => {
          setConfirmClose(false);
          guard.blocker.reset?.();
        }}
        onLeave={() => {
          setConfirmClose(false);
          form.reset(defaults(doc));
          setOpen(false);
          guard.blocker.proceed?.();
        }}
      />
      <Dialog.Trigger asChild>
        <PillButton variant="light" size="md" disabled={disabled}>
          Edit details<span className="sr-only">: {doc.title}</span>
        </PillButton>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40 duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto overscroll-contain rounded-t-3xl bg-white px-gutter pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] shadow-pool-lift duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none md:inset-x-auto md:top-1/2 md:left-1/2 md:bottom-auto md:w-[min(44rem,calc(100vw-4rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-3xl md:p-8">
          <div
            aria-hidden="true"
            className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-surface-deep md:hidden"
          />
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-h3 font-bold text-ink">Edit details</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="-mt-1.5 grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink transition-colors duration-300 hover:bg-surface focus-visible:bg-surface"
            >
              <X aria-hidden="true" className="size-6" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-body text-ink-muted">
            Changes save to this document; the file stays the same.
          </Dialog.Description>

          <form onSubmit={(event) => void submit(event)} noValidate className="mt-6">
            <div className="grid gap-5 md:grid-cols-2">
              <TextField
                label="Title"
                className="md:col-span-2"
                error={errors.title?.message}
                {...form.register('title')}
              />
              <SelectField
                label="Type"
                options={types.map((t) => ({ value: t.id, label: t.name }))}
                error={errors.typeId?.message}
                {...form.register('typeId')}
              />
              <SelectField
                label="Academic year"
                options={years}
                error={errors.academicYear?.message}
                {...form.register('academicYear')}
              />
              <SelectField
                label="Semester"
                placeholder="Not tied to a semester"
                options={semesters}
                error={errors.semester?.message}
                {...form.register('semester', {
                  setValueAs: (value: string) => value || undefined,
                })}
              />
              <Controller
                control={form.control}
                name="tags"
                render={({ field }) => (
                  <TextField
                    label="Tags"
                    hint="Optional, separated by commas"
                    error={errors.tags?.message ?? errors.tags?.[0]?.message}
                    value={tagsToText(field.value)}
                    onChange={(event) => field.onChange(textToTags(event.target.value))}
                    onBlur={field.onBlur}
                  />
                )}
              />
              <TextAreaField
                label="Description"
                hint="Optional"
                className="md:col-span-2"
                error={errors.description?.message}
                {...form.register('description', {
                  setValueAs: (value: string) => value || undefined,
                })}
              />
            </div>
            {saveError ? (
              <p role="alert" className="mt-5 text-body font-medium text-destructive">
                {saveError}
              </p>
            ) : null}
            <div className="mt-8 flex flex-wrap justify-end gap-3">
              <Dialog.Close asChild>
                <PillButton type="button" variant="light" size="md">
                  Cancel
                </PillButton>
              </Dialog.Close>
              <PillButton type="submit" size="md" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Saving…' : 'Save changes'}
              </PillButton>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
