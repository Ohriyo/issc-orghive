import { useId, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useForm } from 'react-hook-form';
import {
  createCollegeRequestSchema,
  createOrganizationRequestSchema,
  LOGO_MAX_BYTES,
  LOGO_MIME_TYPES,
  LOGO_MIN_WIDTH,
  type AdminCollege,
  type AdminOrganization,
  type CreateCollegeRequest,
  type CreateOrganizationRequest,
} from '@orghive/shared';
import { TextAreaField } from '@/components/form-fields';
import { OrgLogo } from '@/components/org-logo';
import { PillButton } from '@/components/pill-button';
import { TextField } from '@/components/text-field';
import { cn } from '@/lib/utils';
import { ConfirmLeaveDialog } from '@/navigation/unsaved-changes-dialog';
import { useUnsavedChangesGuard } from '@/navigation/use-unsaved-changes';
import type { AdminOrganizationsState, Editing } from '../presenters/use-admin-organizations';

type Ready = Extract<AdminOrganizationsState, { status: 'ready' }>;

const orgFormSchema = createOrganizationRequestSchema.pick({
  slug: true,
  acronym: true,
  name: true,
  description: true,
});
type OrgForm = Pick<CreateOrganizationRequest, 'slug' | 'acronym' | 'name' | 'description'>;

/** "ICpEP.SE" → "icpep-se": a starting point for a new slug, which the admin can change. */
function slugFrom(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const optional = { setValueAs: (value: string) => value.trim() || undefined };

/**
 * The side panel for adding or editing a college or an organization. From md it slides
 * in from the right beside the table; on phones it is a bottom sheet. Closing with
 * unsaved changes asks first.
 */
export function OrganizationSheet({ state }: { state: Ready }) {
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const guard = useUnsavedChangesGuard(dirty);
  const open = state.editing !== null;
  const close = () => {
    setDirty(false);
    state.close();
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        if (dirty) setConfirmClose(true);
        else close();
      }}
    >
      <ConfirmLeaveDialog
        open={confirmClose || guard.blocker.state === 'blocked'}
        title="Discard your changes?"
        description="What you entered here has not been saved."
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
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto overscroll-contain rounded-t-2xl bg-white px-gutter pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] shadow-pool-lift duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[min(30rem,100vw)] md:rounded-none md:p-8 md:data-[state=closed]:slide-out-to-right md:data-[state=open]:slide-in-from-right">
          <div
            aria-hidden="true"
            className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-surface-deep md:hidden"
          />
          {state.editing ? (
            <SheetBody
              key={keyOf(state.editing)}
              editing={state.editing}
              state={state}
              onDirtyChange={setDirty}
            />
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function keyOf(editing: NonNullable<Editing>): string {
  return editing.kind === 'college'
    ? `college:${editing.college?.slug ?? 'new'}`
    : `org:${editing.organization?.slug ?? `new-${editing.collegeSlug}-${editing.type}`}`;
}

function SheetBody({
  editing,
  state,
  onDirtyChange,
}: {
  editing: NonNullable<Editing>;
  state: Ready;
  onDirtyChange: (dirty: boolean) => void;
}) {
  if (editing.kind === 'college') {
    return <CollegeForm college={editing.college} state={state} onDirtyChange={onDirtyChange} />;
  }
  const college = state.colleges.find((c) => c.slug === editing.collegeSlug);
  return (
    <OrganizationForm
      organization={editing.organization}
      newIn={
        editing.organization || !college || !editing.type ? null : { college, type: editing.type }
      }
      state={state}
      onDirtyChange={onDirtyChange}
    />
  );
}

function SheetHeader({ title, description }: { title: string; description: string }) {
  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <Dialog.Title className="text-h3 font-bold text-ink">{title}</Dialog.Title>
        <Dialog.Close
          aria-label="Close"
          className="-mt-1.5 -mr-2 grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink transition-colors duration-300 hover:bg-surface focus-visible:bg-surface"
        >
          <X aria-hidden="true" className="size-6" />
        </Dialog.Close>
      </div>
      <Dialog.Description className="mt-1 text-body text-ink-muted">
        {description}
      </Dialog.Description>
    </>
  );
}

function FormActions({ submitting, label }: { submitting: boolean; label: string }) {
  return (
    <div className="mt-8 flex flex-wrap justify-end gap-3">
      <Dialog.Close asChild>
        <PillButton type="button" variant="light" size="md">
          Cancel
        </PillButton>
      </Dialog.Close>
      <PillButton type="submit" size="md" disabled={submitting}>
        {submitting ? 'Saving…' : label}
      </PillButton>
    </div>
  );
}

function SaveError({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="mt-5 text-body font-medium text-destructive">
      {message}
    </p>
  ) : null;
}

function CollegeForm({
  college,
  state,
  onDirtyChange,
}: {
  college: AdminCollege | null;
  state: Ready;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [saveError, setSaveError] = useState<string>();
  const form = useForm<CreateCollegeRequest>({
    resolver: zodResolver(createCollegeRequestSchema),
    defaultValues: {
      code: college?.code ?? '',
      slug: college?.slug ?? '',
      name: college?.name ?? '',
      motto: college?.motto ?? undefined,
      description: college?.description ?? undefined,
    },
  });
  const errors = form.formState.errors;
  const submit = form.handleSubmit(async (values) => {
    setSaveError(undefined);
    const error = await state.saveCollege(college?.slug ?? null, values);
    if (error) setSaveError(error);
  });

  return (
    <>
      <SheetHeader
        title={college ? `Edit ${college.code}` : 'Add a college'}
        description={
          college
            ? 'Changes show on the public college page at once.'
            : 'A new college goes last in the carousel. Add its CSC next.'
        }
      />
      <form
        noValidate
        className="mt-6 grid gap-5"
        onChange={() => onDirtyChange(true)}
        onSubmit={(event) => void submit(event)}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="Code"
            hint="As the college writes it, e.g. CoED"
            error={errors.code?.message}
            {...form.register('code')}
          />
          <TextField
            label="Link name"
            hint={
              college ? 'Fixed: shared links use it' : 'Lowercase, e.g. coed for /colleges/coed'
            }
            disabled={!!college}
            error={errors.slug?.message}
            {...form.register('slug')}
          />
        </div>
        <TextField label="Name" error={errors.name?.message} {...form.register('name')} />
        <TextField
          label="Motto"
          hint="Optional"
          error={errors.motto?.message}
          {...form.register('motto', optional)}
        />
        <TextAreaField
          label="Description"
          hint="Optional. Plain and factual; it appears on the college page."
          error={errors.description?.message}
          {...form.register('description', optional)}
        />
        <SaveError message={saveError} />
        <FormActions
          submitting={form.formState.isSubmitting}
          label={college ? 'Save changes' : 'Add college'}
        />
      </form>
    </>
  );
}

function OrganizationForm({
  organization,
  newIn,
  state,
  onDirtyChange,
}: {
  organization: AdminOrganization | null;
  newIn: { college: AdminCollege; type: 'CSC' | 'SBO' } | null;
  state: Ready;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [saveError, setSaveError] = useState<string>();
  const [slugTouched, setSlugTouched] = useState(!!organization);
  const form = useForm<OrgForm>({
    resolver: zodResolver(orgFormSchema),
    defaultValues: {
      slug: organization?.slug ?? '',
      acronym: organization?.acronym ?? '',
      name: organization?.name ?? '',
      description: organization?.description ?? undefined,
    },
  });
  const errors = form.formState.errors;
  const submit = form.handleSubmit(async (values) => {
    setSaveError(undefined);
    const error = await state.saveOrganization(organization?.slug ?? null, {
      ...values,
      // Edits send only names and description; these two matter for new organizations.
      type: newIn?.type ?? 'SBO',
      collegeSlug: newIn?.college.slug ?? 'unused',
    });
    if (error) setSaveError(error);
  });

  const title = organization
    ? `Edit ${organization.acronym}`
    : newIn?.type === 'CSC'
      ? `Add the CSC of ${newIn.college.code}`
      : `Add an SBO to ${newIn?.college.code ?? 'a college'}`;
  const acronym = form.register('acronym');

  return (
    <>
      <SheetHeader
        title={title}
        description={
          organization
            ? 'Changes show on its public page at once.'
            : 'It starts active, last in its carousel.'
        }
      />
      {organization ? <LogoField organization={organization} state={state} /> : null}
      <form
        noValidate
        className="mt-6 grid gap-5"
        onChange={() => onDirtyChange(true)}
        onSubmit={(event) => void submit(event)}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="Short name"
            hint="e.g. JPICE"
            error={errors.acronym?.message}
            {...acronym}
            onChange={(event) => {
              void acronym.onChange(event);
              if (!slugTouched) form.setValue('slug', slugFrom(event.target.value));
            }}
          />
          <TextField
            label="Link name"
            hint={
              organization ? 'Fixed: shared links use it' : 'Lowercase, e.g. jpice for /orgs/jpice'
            }
            disabled={!!organization}
            error={errors.slug?.message}
            {...form.register('slug', { onChange: () => setSlugTouched(true) })}
          />
        </div>
        <TextField label="Full name" error={errors.name?.message} {...form.register('name')} />
        <TextAreaField
          label="Description"
          hint="Optional. Use the organization's own words; never invent one."
          error={errors.description?.message}
          {...form.register('description', optional)}
        />
        <SaveError message={saveError} />
        <FormActions
          submitting={form.formState.isSubmitting}
          label={organization ? 'Save changes' : 'Add organization'}
        />
      </form>
    </>
  );
}

function LogoField({ organization, state }: { organization: AdminOrganization; state: Ready }) {
  const id = useId();
  const [status, setStatus] = useState<{ busy: boolean; error?: string }>({ busy: false });

  async function upload(file: File) {
    if (file.size > LOGO_MAX_BYTES) {
      setStatus({ busy: false, error: 'Choose an image under 2 MB.' });
      return;
    }
    setStatus({ busy: true });
    const error = await state.uploadLogo(organization.slug, file);
    setStatus({ busy: false, error: error ?? undefined });
  }

  return (
    <div className="mt-6 flex items-center gap-4 rounded-xl bg-surface p-4">
      <OrgLogo
        name={organization.name}
        src={organization.logoUrl ?? undefined}
        alt=""
        fallbackText={organization.acronym}
        className={cn(
          'size-16 shrink-0 rounded-full',
          organization.logoUrl ? 'bg-white' : 'bg-forest-band',
        )}
      />
      <div className="min-w-0">
        <label
          htmlFor={id}
          className="tap-area inline-flex cursor-pointer text-body font-semibold text-ink underline decoration-1 underline-offset-4 has-[:focus-visible]:decoration-leaf hover:decoration-leaf"
        >
          {status.busy ? 'Uploading…' : organization.logoUrl ? 'Replace logo' : 'Upload logo'}
          <input
            id={id}
            type="file"
            accept={LOGO_MIME_TYPES.join(',')}
            className="sr-only"
            disabled={status.busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void upload(file);
            }}
          />
        </label>
        <p className="mt-1 text-small text-ink-muted">
          PNG, JPEG or WebP, at least {LOGO_MIN_WIDTH} px wide, up to 2 MB. Square works best.
        </p>
        {status.error ? (
          <p role="alert" className="mt-1 text-small font-medium text-destructive">
            {status.error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
