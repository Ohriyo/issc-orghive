import { useState } from 'react';
import { Check, Copy, KeyRound, Send } from 'lucide-react';
import { LOGO_MIME_TYPES } from '@orghive/shared';
import { SelectField, TextAreaField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { TextField } from '@/components/text-field';
import { FormAlert } from '@/features/auth/views/auth-layout';
import { OriginLink } from '@/navigation/origin-link';
import type { CreateAccountModel, CreatedResult } from '../presenters/use-create-account';
import { SystemLoading } from './system-layout';

const TYPE_CHOICES = [
  { value: 'SBO', label: 'SBO (student body organization)' },
  { value: 'CSC', label: 'CSC (collegiate student council)' },
  { value: 'ISSC', label: 'ISSC' },
];
const MODE_CHOICES = [
  { value: 'existing', label: 'An existing organization' },
  { value: 'new', label: 'A new organization' },
];
const FIELDSET = 'flex flex-col gap-5 rounded-2xl bg-white p-5 ring-1 ring-border md:p-6';
const LEGEND = 'mb-1 text-h3 font-bold text-ink';
const TEXT_LINK =
  'tap-area rounded-sm font-medium text-ink underline underline-offset-4 decoration-ink/40 transition-colors hover:decoration-ink focus-visible:decoration-ink';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <PillButton
      type="button"
      variant="light"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true));
      }}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copied ? 'Copied' : 'Copy'}
    </PillButton>
  );
}

function Created({ result, onAnother }: { result: CreatedResult; onAnother: () => void }) {
  return (
    <section
      aria-labelledby="created-heading"
      className="flex flex-col gap-4 rounded-2xl bg-white p-5 ring-1 ring-border md:p-6"
    >
      <h2 id="created-heading" className="text-h3 font-bold text-ink">
        {result.acronym}&rsquo;s account is ready
      </h2>
      <p className="text-body text-ink">
        It signs in as <span className="font-medium break-all">{result.email}</span> and must change
        its temporary password first.
      </p>
      {result.temporaryPassword ? (
        <div role="alert" className="flex flex-col gap-3 rounded-xl bg-caution-surface p-4">
          <p className="flex items-center gap-2 font-semibold text-caution">
            <KeyRound aria-hidden="true" className="size-5 shrink-0" />
            Shown once: copy it now
          </p>
          <p className="text-body text-ink">
            This is the ISSC account&rsquo;s own temporary password, so nobody else could receive
            it. It is not stored anywhere and cannot be shown again.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <code className="rounded-lg bg-white px-3 py-2 font-mono text-lead tracking-wide break-all text-ink ring-1 ring-border">
              {result.temporaryPassword}
            </code>
            <CopyButton text={result.temporaryPassword} />
          </div>
        </div>
      ) : (
        <p className="flex items-start gap-2 text-body text-ink">
          <Send aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-forest-500" />
          <span>
            The temporary password went to the ISSC account&rsquo;s notifications, behind a one-time
            Reveal (until {result.revealUntil}). You do not see it.
          </span>
        </p>
      )}
      {result.logoError ? <FormAlert message={result.logoError} /> : null}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <PillButton asChild>
          <OriginLink to={result.accountHref}>Open the account</OriginLink>
        </PillButton>
        <button type="button" className={TEXT_LINK} onClick={onAnother}>
          Create another
        </button>
      </div>
    </section>
  );
}

/** /system/users/new */
export function CreateAccountView({ model }: { model: CreateAccountModel }) {
  if (model.result) return <Created result={model.result} onAnother={model.startOver} />;
  if (model.tree.status === 'loading') return <SystemLoading label="Loading organizations" />;
  if (model.tree.status === 'error') {
    return (
      <SectionError message="The organizations could not be loaded." onRetry={model.tree.retry} />
    );
  }

  const { form } = model;
  const errors = form.formState.errors;
  return (
    <form
      noValidate
      onSubmit={(event) => void model.onSubmit(event)}
      className="flex max-w-3xl flex-col gap-6"
    >
      <FormAlert message={model.submitError ?? undefined} />
      {model.fromRequest ? (
        <p
          role="note"
          className="rounded-xl bg-forest-500/10 px-4 py-3 text-body text-ink ring-1 ring-forest-500/20"
        >
          {model.fromRequest.stillOpen
            ? `Filled in from the ISSC's request for ${model.fromRequest.organization}${
                model.fromRequest.requestedBy ? ` (${model.fromRequest.requestedBy})` : ''
              }. Creating the account fulfils it.`
            : `The request for ${model.fromRequest.organization} was already decided; this creates an account without it.`}
          {model.fromRequest.note ? ` Note: ${model.fromRequest.note}` : ''}
        </p>
      ) : null}

      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>Organization</legend>
        <div className="grid gap-5 md:grid-cols-2">
          <SelectField
            label="Type"
            options={TYPE_CHOICES}
            error={errors.type?.message}
            {...form.register('type')}
          />
          {model.showCollege ? (
            <SelectField
              label="College"
              placeholder="Choose a college"
              options={model.colleges}
              error={errors.collegeSlug?.message}
              {...form.register('collegeSlug')}
            />
          ) : null}
        </div>
        {model.canCreateNew ? (
          <SelectField label="Account for" options={MODE_CHOICES} {...form.register('mode')} />
        ) : null}

        {model.mode === 'existing' ? (
          <SelectField
            label="Organization"
            placeholder={
              model.existingChoices.length > 0
                ? 'Choose an organization'
                : 'None without an account'
            }
            hint="Only organizations without an active account are listed."
            options={model.existingChoices}
            error={errors.existingSlug?.message}
            {...form.register('existingSlug')}
            value={model.existingSlug}
          />
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            <TextField
              label="Acronym"
              error={errors.newOrg?.acronym?.message}
              {...form.register('newOrg.acronym', {
                onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
                  model.suggestSlug(event.target.value),
              })}
            />
            <TextField
              label="Address (slug)"
              hint="Used in its page address, e.g. /orgs/jpice."
              error={errors.newOrg?.slug?.message}
              {...form.register('newOrg.slug')}
            />
            <TextField
              label="Full name"
              className="md:col-span-2"
              error={errors.newOrg?.name?.message}
              {...form.register('newOrg.name')}
            />
            <TextAreaField
              label="Description (optional)"
              className="md:col-span-2"
              rows={3}
              error={errors.newOrg?.description?.message}
              {...form.register('newOrg.description')}
            />
            <TextField
              label="Logo (optional)"
              type="file"
              accept={LOGO_MIME_TYPES.join(',')}
              className="md:col-span-2"
              hint="PNG, JPEG or WebP, up to 2 MB. It can also be added later from /admin."
              error={model.logo.error ?? undefined}
              onChange={(event) => model.logo.choose(event.target.files?.[0] ?? null)}
            />
          </div>
        )}
      </fieldset>

      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>Sign-in</legend>
        <TextField
          label="Account email"
          type="email"
          autoComplete="off"
          hint="The organization's shared address. Its officers sign in with it."
          error={errors.email?.message}
          {...form.register('email')}
        />
      </fieldset>

      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>Officer in charge</legend>
        <div className="grid gap-5 md:grid-cols-2">
          <TextField
            label="Name"
            autoComplete="off"
            error={errors.officerInCharge?.name?.message}
            {...form.register('officerInCharge.name')}
          />
          <TextField
            label="Position"
            placeholder="e.g. President"
            error={errors.officerInCharge?.position?.message}
            {...form.register('officerInCharge.position')}
          />
          <TextField
            label="Contact email"
            type="email"
            autoComplete="off"
            error={errors.officerInCharge?.email?.message}
            {...form.register('officerInCharge.email')}
          />
          <TextField label="Term ends (optional)" type="date" {...form.register('termEnd')} />
        </div>
      </fieldset>

      <p className="max-w-prose text-body text-ink-muted">
        Orghive makes a temporary password and sends it to the ISSC account&rsquo;s one-time Reveal.
        You never see it, except for the ISSC account&rsquo;s own.
      </p>
      <PillButton type="submit" size="lg" className="self-start" disabled={model.isSubmitting}>
        {model.isSubmitting ? 'Creating…' : 'Create account'}
      </PillButton>
    </form>
  );
}
