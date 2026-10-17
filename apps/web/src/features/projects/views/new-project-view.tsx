import { Container } from '@/components/container';
import { TextAreaField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { TextField } from '@/components/text-field';
import { ConfirmLeaveDialog } from '@/navigation/unsaved-changes-dialog';
import type { NewProjectModel } from '../presenters/use-new-project';

type Ready = Extract<NewProjectModel, { status: 'ready' }>;

/** /dashboard/projects/new: the five required fields and the optional meeting documents. */
export function NewProjectView({ model }: { model: NewProjectModel }) {
  return (
    <div className="bg-surface-sweep min-h-page">
      <title>New project | Orghive</title>
      <Container as="main" className="max-w-3xl pt-4 pb-section lg:pt-6">
        {model.status === 'loading' ? (
          <div aria-busy="true" aria-label="Loading" className="mt-8">
            <Skeleton className="h-12 w-64" />
            <Skeleton className="mt-8 h-96 w-full rounded-3xl" />
          </div>
        ) : model.status === 'error' ? (
          <>
            <h1 className="mt-8 text-h1 font-bold text-ink">New project</h1>
            <SectionError
              className="mt-6"
              message="This form could not be loaded. Check your connection and try again."
              onRetry={model.retry}
            />
          </>
        ) : model.status === 'no-organization' || model.status === 'forbidden' ? (
          <>
            <h1 className="mt-8 text-h1 font-bold text-ink">New project</h1>
            <p className="mt-4 max-w-prose text-body-lg text-ink">
              {model.status === 'forbidden'
                ? `Only ${model.org.acronym}'s officers create its projects.`
                : 'You’re not in an organization yet, so you cannot create a project.'}
            </p>
          </>
        ) : (
          <ProjectForm model={model} />
        )}
      </Container>
    </div>
  );
}

function ProjectForm({ model }: { model: Ready }) {
  const { form } = model;
  const errors = form.formState.errors;
  return (
    <>
      <ConfirmLeaveDialog
        open={model.leave.asking}
        onStay={model.leave.stay}
        onLeave={model.leave.go}
        title="Leave without creating the project?"
        description="What you entered has not been saved."
      />
      <header className="mt-8">
        <h1 className="text-h1 font-bold text-ink">New project</h1>
        <p className="mt-2 text-lead text-ink">{model.org.name}</p>
        <p className="mt-4 max-w-prose text-body text-ink-muted">
          After you create it, upload the scanned, signed Project Proposal within 14 days. The
          Activity Completion Report and Financial Report are due 14 days after the event.
        </p>
      </header>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          model.submit();
        }}
        className="mt-8 flex flex-col gap-6 rounded-3xl bg-white p-5 shadow-pool ring-1 ring-ink/10 md:p-8"
      >
        <TextField
          label="Project name"
          autoComplete="off"
          error={errors.name?.message}
          {...form.register('name')}
        />
        <div className="grid gap-6 md:grid-cols-2">
          <TextField
            label="Target date"
            type="date"
            min={model.minDate}
            hint="The event date. It cannot be in the past."
            error={errors.targetDate?.message}
            {...form.register('targetDate')}
          />
          <TextField
            label="Location"
            autoComplete="off"
            error={errors.location?.message}
            {...form.register('location')}
          />
        </div>
        <TextField
          label="Target beneficiaries"
          hint="Who the project is for, e.g. first-year civil engineering students"
          autoComplete="off"
          error={errors.beneficiaries?.message}
          {...form.register('beneficiaries')}
        />
        <TextAreaField
          label="Brief description"
          error={errors.description?.message}
          {...form.register('description')}
        />
        <fieldset>
          <legend className="text-body font-medium text-ink">Meeting documents</legend>
          <p className="mt-1 text-small text-ink-muted">
            Check the ones this project needs. They unlock once the proposal is submitted.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:gap-6">
            {(
              [
                ['nomRequired', 'Notice of Meeting (NOM)'],
                ['momRequired', 'Minutes of Meeting (MOM)'],
              ] as const
            ).map(([name, label]) => (
              <label
                key={name}
                className="flex min-h-11 cursor-pointer items-center gap-3 text-body text-ink"
              >
                <input
                  type="checkbox"
                  className="size-5 accent-forest-700"
                  {...form.register(name)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {model.saveError ? (
          <p role="alert" className="text-body font-medium text-destructive">
            {model.saveError}
          </p>
        ) : null}
        <div className="flex justify-end">
          <PillButton type="submit" size="md" disabled={model.saving} className="max-sm:w-full">
            {model.saving ? 'Creating…' : 'Create project'}
          </PillButton>
        </div>
      </form>
    </>
  );
}
