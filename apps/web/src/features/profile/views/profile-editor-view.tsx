import { useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Lock, Plus, Trash2 } from 'lucide-react';
import { LOGO_MIN_WIDTH, PROFILE_DESCRIPTION_MAX, PROFILE_STATEMENT_MAX } from '@orghive/shared';
import { ActingAsField } from '@/components/acting-as-field';
import { Container } from '@/components/container';
import { TextAreaField } from '@/components/form-fields';
import { HexFrame } from '@/components/hex-frame';
import { OrgLogo } from '@/components/org-logo';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { TextField } from '@/components/text-field';
import { ToggleSwitch } from '@/components/toggle-switch';
import type { ConstitutionModel } from '@/features/organizations/presenters/use-constitution';
import { cn } from '@/lib/utils';
import { OriginLink } from '@/navigation/origin-link';
import { ConfirmLeaveDialog } from '@/navigation/unsaved-changes-dialog';
import type { ConstitutionEditorModel } from '../presenters/use-constitution-upload';
import {
  ACCEPTED_IMAGES,
  type ProfileEditorModel,
  type ReadyProfileEditor,
} from '../presenters/use-profile-editor';
import { ConstitutionEditor } from './constitution-editor';
import { LogoCropper } from './logo-cropper';
import { ProfilePreview } from './profile-preview';

export interface ProfileEditorViewProps {
  model: ProfileEditorModel;
  constitution: ConstitutionEditorModel;
  /** The public page's own constitution model, for the preview. */
  previewConstitution: ConstitutionModel;
}

const LEVEL = { ISSC: 'University council (ISSC)', CSC: 'Collegiate Student Council', SBO: 'Student body organization' };
const H2 = 'text-h3 font-bold text-ink';
const SECTION = 'border-t border-ink/10 pt-8 first:border-t-0 first:pt-0';
const ICON_BUTTON =
  'flex size-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors duration-300 hover:bg-pill-light focus-visible:bg-pill-light disabled:cursor-not-allowed disabled:opacity-40';

/** /dashboard/profile: the form beside a live preview of the public page. */
export function ProfileEditorView({ model, constitution, previewConstitution }: ProfileEditorViewProps) {
  return (
    <div className="bg-surface-sweep min-h-page">
      <title>Organization profile | Orghive</title>
      <Container as="main" className="pt-4 pb-section lg:pt-6">
        {model.status === 'loading' ? (
          <div aria-busy="true" aria-label="Loading your profile" className="mt-8">
            <Skeleton className="h-12 w-72" />
            <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]">
              <Skeleton className="h-[40rem] w-full rounded-3xl" />
              <Skeleton className="hidden h-[32rem] w-full rounded-3xl lg:block" />
            </div>
          </div>
        ) : model.status === 'error' ? (
          <>
            <h1 className="mt-8 text-h1 font-bold text-ink">Organization profile</h1>
            <SectionError
              className="mt-6"
              message="Your profile could not be loaded. Check your connection and try again."
              onRetry={model.retry}
            />
          </>
        ) : model.status === 'no-organization' ? (
          <>
            <h1 className="mt-8 text-h1 font-bold text-ink">Organization profile</h1>
            <p className="mt-4 max-w-prose text-body-lg text-ink">
              This account does not act for an organization, so it has no profile to edit.
            </p>
          </>
        ) : (
          <Editor model={model} constitution={constitution} previewConstitution={previewConstitution} />
        )}
      </Container>
    </div>
  );
}

function Editor({
  model,
  constitution,
  previewConstitution,
}: {
  model: ReadyProfileEditor;
  constitution: ConstitutionEditorModel;
  previewConstitution: ConstitutionModel;
}) {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  return (
    <>
      <ConfirmLeaveDialog
        open={model.leave.asking}
        onStay={model.leave.stay}
        onLeave={model.leave.go}
        description="Your profile changes have not been saved. If you leave now they will be lost."
      />
      <LogoCropper
        logo={model.logo.pending}
        acronym={model.org.acronym}
        onAccept={model.logo.accept}
        onCancel={model.logo.cancel}
      />
      <header className="mt-8 max-w-prose">
        <h1 className="text-h1 font-bold text-balance text-ink">{model.org.acronym} profile</h1>
        <p className="mt-3 text-body-lg text-pretty text-ink">
          What visitors see on your organization page. Nothing changes there until you save.{' '}
          <OriginLink
            to={model.publicHref}
            className="tap-area font-medium underline decoration-1 underline-offset-4 hover:decoration-leaf focus-visible:decoration-leaf"
          >
            Open your page
          </OriginLink>
        </p>
      </header>

      <div
        role="group"
        aria-label="Show"
        className="mt-6 inline-flex rounded-full bg-white p-1 shadow-pool ring-1 ring-ink/10 lg:hidden"
      >
        {(['edit', 'preview'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className="h-11 rounded-full px-6 text-body font-medium text-ink transition-colors duration-300 aria-pressed:bg-forest-700 aria-pressed:text-white"
          >
            {value === 'edit' ? 'Edit' : 'Preview'}
          </button>
        ))}
      </div>

      <div className="mt-8 grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]">
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            model.save();
          }}
          className={cn('min-w-0', mode === 'preview' && 'max-lg:hidden')}
        >
          <div className="flex flex-col gap-10 rounded-3xl bg-white p-5 shadow-pool ring-1 ring-ink/10 md:p-8">
            <Official model={model} />
            <section className={SECTION} aria-labelledby="acting-heading">
              <h2 id="acting-heading" className="sr-only">
                Who is editing
              </h2>
              <ActingAsField
                orgAcronym={model.org.acronym}
                value={model.actingAs.value}
                onChange={(event) => model.actingAs.onChange(event.target.value)}
                error={model.actingAs.error}
              />
            </section>
            <Images model={model} />
            <About model={model} />
            <Officers model={model} />
            <Contact model={model} />
            <ConstitutionEditor model={constitution} acronym={model.org.acronym} className={SECTION} />
          </div>
          <SaveBar model={model} />
        </form>

        <aside
          aria-labelledby="preview-heading"
          className={cn('min-w-0 lg:sticky lg:top-[calc(var(--header-h)+1.5rem)]', mode === 'edit' && 'max-lg:hidden')}
        >
          <h2 id="preview-heading" className="text-body font-semibold text-ink">
            Preview
          </h2>
          <p className="mt-1 mb-4 text-small text-ink-muted">
            Your page as visitors will see it once you save. Hidden officers are left out.
          </p>
          <ProfilePreview page={model.preview} constitution={previewConstitution} />
        </aside>
      </div>
    </>
  );
}

function Official({ model }: { model: ReadyProfileEditor }) {
  const { official } = model.profile;
  const rows: [string, string][] = [
    ['Official name', official.name],
    ['Acronym', official.acronym],
    ['Level', LEVEL[official.type]],
    ...(official.college ? ([['College', official.college.name]] as [string, string][]) : []),
  ];
  return (
    <section className={SECTION} aria-labelledby="official-heading">
      <h2 id="official-heading" className={H2}>
        Official details
      </h2>
      <p className="mt-2 flex items-start gap-2 text-body text-ink-muted">
        <Lock aria-hidden="true" className="mt-1 size-4 shrink-0" />
        <span>Managed by the ISSC. To change any of these, contact the ISSC.</span>
      </p>
      <dl className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {rows.map(([term, value]) => (
          <div key={term}>
            <dt className="text-small text-ink-muted">{term}</dt>
            <dd className="mt-0.5 text-body font-medium text-pretty text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** A visible button that opens a hidden file input (keyboard and touch friendly). */
function FileButton({
  label,
  accept,
  onFile,
  variant = 'light',
}: {
  label: string;
  accept: string;
  onFile: (file: File) => void;
  variant?: 'light' | 'forest';
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
      <PillButton type="button" variant={variant} onClick={() => input.current?.click()}>
        {label}
      </PillButton>
    </>
  );
}

function Images({ model }: { model: ReadyProfileEditor }) {
  const { logo, cover } = model;
  return (
    <section className={SECTION} aria-labelledby="images-heading">
      <h2 id="images-heading" className={H2}>
        Logo and cover
      </h2>
      <div className="mt-6 grid gap-10 md:grid-cols-[auto_minmax(0,1fr)] md:gap-12">
        <div className="flex flex-col items-start gap-4">
          <HexFrame className="w-32" contentClassName="p-[16%]">
            <OrgLogo
              name={model.org.name}
              src={logo.src ?? undefined}
              alt=""
              sizes="128px"
              fallbackText={model.org.acronym}
              className="size-full"
            />
          </HexFrame>
          <div className="flex flex-wrap gap-2">
            <FileButton label={logo.src ? 'Change logo' : 'Add a logo'} accept={ACCEPTED_IMAGES} onFile={logo.choose} />
            {logo.staged ? (
              <PillButton type="button" variant="light" onClick={logo.revert}>
                Undo
              </PillButton>
            ) : null}
          </div>
          <p className="max-w-[28ch] text-small text-ink-muted">
            PNG, JPEG or WebP, up to 2 MB, at least {LOGO_MIN_WIDTH} px wide. You fit it to the
            hexagon next.
          </p>
          {logo.error ? (
            <p role="alert" className="text-small font-medium text-destructive">
              {logo.error}
            </p>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col items-start gap-4">
          <div className="aspect-[3/1] w-full overflow-hidden rounded-2xl bg-surface-deep/60 ring-1 ring-ink/10">
            {cover.src ? (
              <img src={cover.src} alt="" className="size-full object-cover" />
            ) : (
              <p className="flex size-full items-center justify-center px-4 text-center text-small text-ink-muted">
                {cover.removed ? 'The cover will be removed when you save' : 'No cover image'}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <FileButton label={cover.src ? 'Change cover' : 'Add a cover'} accept={ACCEPTED_IMAGES} onFile={cover.choose} />
            {cover.staged || cover.removed ? (
              <PillButton type="button" variant="light" onClick={cover.revert}>
                Undo
              </PillButton>
            ) : cover.src ? (
              <PillButton type="button" variant="light" onClick={cover.remove}>
                Remove cover
              </PillButton>
            ) : null}
          </div>
          <p className="text-small text-ink-muted">
            A wide photo, at least 1200 px wide and up to 5 MB. It runs across your page under
            the header, cropped to fit.
          </p>
          {cover.error ? (
            <p role="alert" className="text-small font-medium text-destructive">
              {cover.error}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** The characters left, once the box is past 80% of its limit. */
function counter(value: string | null | undefined, max: number): string | undefined {
  const length = value?.length ?? 0;
  return length > max * 0.8 ? `${max - length} characters left` : undefined;
}

function About({ model }: { model: ReadyProfileEditor }) {
  const { form } = model;
  const errors = form.formState.errors;
  const values = form.watch();
  return (
    <section className={SECTION} aria-labelledby="about-edit-heading">
      <h2 id="about-edit-heading" className={H2}>
        About
      </h2>
      <div className="mt-6 flex flex-col gap-6">
        <TextAreaField
          label="Description"
          rows={4}
          maxLength={PROFILE_DESCRIPTION_MAX}
          hint={counter(values.description, PROFILE_DESCRIPTION_MAX) ?? 'Shown beside your logo at the top of your page.'}
          error={errors.description?.message}
          {...form.register('description')}
        />
        <TextAreaField
          label="Mission"
          rows={3}
          maxLength={PROFILE_STATEMENT_MAX}
          hint={counter(values.mission, PROFILE_STATEMENT_MAX)}
          error={errors.mission?.message}
          {...form.register('mission')}
        />
        <TextAreaField
          label="Vision"
          rows={3}
          maxLength={PROFILE_STATEMENT_MAX}
          hint={counter(values.vision, PROFILE_STATEMENT_MAX)}
          error={errors.vision?.message}
          {...form.register('vision')}
        />
      </div>
    </section>
  );
}

function Officers({ model }: { model: ReadyProfileEditor }) {
  const { form, officers } = model;
  const errors = form.formState.errors.officers;
  return (
    <section className={SECTION} aria-labelledby="officers-edit-heading">
      <h2 id="officers-edit-heading" className={H2}>
        Officers
      </h2>
      <p className="mt-2 max-w-prose text-body text-ink-muted">
        In the order they appear on your page. Turn off “Show publicly” to keep someone off it.
      </p>
      {officers.fields.length === 0 ? (
        <p className="mt-6 rounded-2xl bg-surface px-5 py-4 text-body text-ink">
          No officers listed yet. Add the ones you want visitors to see.
        </p>
      ) : (
        <ol className="mt-6 flex flex-col">
          {officers.fields.map((field, index) => (
            <OfficerRow
              key={field.id}
              model={model}
              index={index}
              error={errors?.[index]}
              last={index === officers.fields.length - 1}
            />
          ))}
        </ol>
      )}
      {errors?.root?.message ?? errors?.message ? (
        <p role="alert" className="mt-4 text-small font-medium text-destructive">
          {errors.root?.message ?? errors.message}
        </p>
      ) : null}
      {model.canAddOfficer ? (
        <PillButton
          type="button"
          variant="light"
          className="mt-6"
          onClick={() => officers.append({ position: '', name: '', isPublic: true })}
        >
          <Plus aria-hidden="true" />
          Add an officer
        </PillButton>
      ) : null}
    </section>
  );
}

function OfficerRow({
  model,
  index,
  error,
  last,
}: {
  model: ReadyProfileEditor;
  index: number;
  error?: { position?: { message?: string }; name?: { message?: string } };
  last: boolean;
}) {
  const { form, officers } = model;
  const switchLabel = useId();
  const position = form.watch(`officers.${index}.position`);
  const isPublic = form.watch(`officers.${index}.isPublic`) !== false;
  const who = position?.trim() || `officer ${index + 1}`;
  return (
    <li className="grid gap-4 border-t border-ink/10 py-5 first:border-t-0 first:pt-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] md:gap-x-4">
      <TextField
        label="Position"
        placeholder="e.g. President"
        autoComplete="off"
        error={error?.position?.message}
        {...form.register(`officers.${index}.position`)}
      />
      <TextField
        label="Name"
        placeholder="e.g. Ana Reyes"
        autoComplete="off"
        error={error?.name?.message}
        {...form.register(`officers.${index}.name`)}
      />
      <div className="flex items-center justify-between gap-2 md:col-span-2">
        <div className="flex min-h-11 items-center gap-2">
          <ToggleSwitch
            labelledBy={switchLabel}
            checked={isPublic}
            onCheckedChange={(checked) =>
              form.setValue(`officers.${index}.isPublic`, checked, { shouldDirty: true })
            }
          />
          <span id={switchLabel} className="text-small text-ink">
            Show publicly
          </span>
        </div>
        <div className="flex items-center">
          <button
            type="button"
            className={ICON_BUTTON}
            disabled={index === 0}
            onClick={() => officers.move(index, index - 1)}
            aria-label={`Move ${who} up`}
          >
            <ChevronUp aria-hidden="true" className="size-5" />
          </button>
          <button
            type="button"
            className={ICON_BUTTON}
            disabled={last}
            onClick={() => officers.move(index, index + 1)}
            aria-label={`Move ${who} down`}
          >
            <ChevronDown aria-hidden="true" className="size-5" />
          </button>
          <button
            type="button"
            className={cn(ICON_BUTTON, 'hover:text-destructive focus-visible:text-destructive')}
            onClick={() => officers.remove(index)}
            aria-label={`Remove ${who}`}
          >
            <Trash2 aria-hidden="true" className="size-5" />
          </button>
        </div>
      </div>
    </li>
  );
}

function Contact({ model }: { model: ReadyProfileEditor }) {
  const { form, links } = model;
  const errors = form.formState.errors;
  return (
    <section className={SECTION} aria-labelledby="contact-edit-heading">
      <h2 id="contact-edit-heading" className={H2}>
        Contact and links
      </h2>
      <div className="mt-6 flex flex-col gap-6">
        <TextField
          label="Contact email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="e.g. council@nwssu.edu.ph"
          error={errors.contactEmail?.message}
          {...form.register('contactEmail')}
        />
        <TextField
          label="Facebook page"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://facebook.com/yourpage"
          error={errors.facebookUrl?.message}
          {...form.register('facebookUrl')}
        />
        <fieldset>
          <legend className="text-body font-medium text-ink">Other links</legend>
          <p className="mt-1 text-small text-ink-muted">
            Instagram, TikTok, YouTube, a website… Full links that start with https://.
          </p>
          {links.values.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-3">
              {links.values.map((url, index) => (
                <LinkRow
                  key={index}
                  index={index}
                  url={url}
                  kind={links.kinds[index] ?? null}
                  error={errors.links?.[index]?.message}
                  onChange={(value) => links.change(index, value)}
                  onRemove={() => links.remove(index)}
                />
              ))}
            </ul>
          ) : null}
          {errors.links?.message ?? errors.links?.root?.message ? (
            <p role="alert" className="mt-3 text-small font-medium text-destructive">
              {errors.links.message ?? errors.links.root?.message}
            </p>
          ) : null}
          {links.canAdd ? (
            <PillButton type="button" variant="light" className="mt-4" onClick={links.add}>
              <Plus aria-hidden="true" />
              Add a link
            </PillButton>
          ) : null}
        </fieldset>
      </div>
    </section>
  );
}

function LinkRow({
  index,
  url,
  kind,
  error,
  onChange,
  onRemove,
}: {
  index: number;
  url: string;
  kind: string | null;
  error?: string;
  onChange: (value: string) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-start gap-2">
      <TextField
        label={kind ? `Link ${index + 1}: ${kind}` : `Link ${index + 1}`}
        type="url"
        inputMode="url"
        placeholder="https://"
        value={url}
        error={error}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1"
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove link ${index + 1}`}
        className={cn(ICON_BUTTON, 'mt-9 hover:text-destructive focus-visible:text-destructive')}
      >
        <Trash2 aria-hidden="true" className="size-5" />
      </button>
    </li>
  );
}

function SaveBar({ model }: { model: ReadyProfileEditor }): ReactNode {
  return (
    <div className="pb-safe sticky bottom-0 z-10 mt-6">
      <div className="flex items-center justify-between gap-4 rounded-3xl bg-white/95 py-3 pr-3 pl-5 shadow-pool-lift ring-1 ring-ink/10 backdrop-blur-sm md:py-4 md:pr-4 md:pl-8">
        <p role="status" className="min-w-0 text-small text-ink md:text-body">
          {model.saveError ? (
            <span className="font-medium text-destructive">{model.saveError}</span>
          ) : model.saving ? (
            'Saving…'
          ) : model.dirty ? (
            'You have unsaved changes.'
          ) : (
            <span className="text-ink-muted">Everything is saved.</span>
          )}
        </p>
        <PillButton type="submit" className="shrink-0" disabled={model.saving || !model.dirty}>
          {model.saving ? 'Saving…' : 'Save changes'}
        </PillButton>
      </div>
    </div>
  );
}
