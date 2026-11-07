import { ImagePlus, X } from 'lucide-react';
import { useId } from 'react';
import {
  POST_BODY_MAX,
  POST_GALLERY_MAX,
  POST_SUMMARY_MAX,
  POST_TITLE_MAX,
} from '@orghive/shared';
import { ActingAsField } from '@/components/acting-as-field';
import { Container } from '@/components/container';
import { TextAreaField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { TextField } from '@/components/text-field';
import { cn } from '@/lib/utils';
import { ConfirmLeaveDialog } from '@/navigation/unsaved-changes-dialog';
import { IMAGE_HINT, type PostEditorState } from '../presenters/use-post-editor';

type Ready = Extract<PostEditorState, { status: 'ready' }>;

/** /dashboard/posts/new and /dashboard/posts/:id. */
export function PostEditorView({ state }: { state: PostEditorState }) {
  const heading = state.status === 'ready' && !state.isNew ? 'Edit post' : 'New post';
  return (
    <Container as="main" className="max-w-3xl pt-8 pb-section">
      <title>{`${heading} | Orghive`}</title>
      <h1 className="text-h1 font-bold text-ink">{heading}</h1>
      {state.status === 'ready' ? (
        <Editor model={state} />
      ) : state.status === 'not-found' ? (
        <p className="mt-6 text-body-lg text-ink">This post no longer exists.</p>
      ) : state.status === 'no-organization' ? (
        <p className="mt-6 text-body-lg text-ink">
          Sign in with your organization’s account to write posts.
        </p>
      ) : state.status === 'error' ? (
        <SectionError
          className="mt-6"
          message="This post could not be loaded. Check your connection and try again."
          onRetry={state.retry}
        />
      ) : (
        <div aria-busy="true" className="mt-8 space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}
    </Container>
  );
}

function Editor({ model }: { model: Ready }) {
  const { form } = model;
  const errors = form.formState.errors;
  const type = form.watch('type');
  const cover = form.watch('cover');
  const gallery = form.watch('gallery');
  const coverInput = useId();
  const galleryInput = useId();
  const live = model.current === 'PUBLISHED';

  return (
    <form
      className="mt-8 flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        model.save(live ? 'draft' : 'publish');
      }}
      noValidate
    >
      <ConfirmLeaveDialog
        open={model.leave.asking}
        onStay={model.leave.stay}
        onLeave={model.leave.go}
        title="Leave without saving the post?"
        description="What you wrote has not been saved."
      />

      {model.isNew ? (
        <fieldset>
          <legend className="text-body font-medium text-ink">Kind of post</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {(
              [
                ['UPDATE', 'Update', 'News for the updates list'],
                ['HIGHLIGHT', 'Highlight', 'An achievement or flagship event; can be pinned to the carousel'],
              ] as const
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className={cn(
                  'flex min-h-11 flex-1 cursor-pointer flex-col rounded-2xl border bg-white px-4 py-3 sm:min-w-56',
                  type === value ? 'border-forest-700 ring-2 ring-forest-700' : 'border-sage/70',
                )}
              >
                <span className="flex items-center gap-2 text-body font-semibold text-ink">
                  <input type="radio" value={value} {...form.register('type')} className="size-4 accent-forest-700" />
                  {label}
                </span>
                <span className="mt-1 text-small text-ink-muted">{hint}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <TextField
        label="Title"
        maxLength={POST_TITLE_MAX}
        error={errors.title?.message}
        {...form.register('title')}
      />
      <TextAreaField
        label="Summary"
        hint={`Up to ${POST_SUMMARY_MAX} characters: shown on cards and in the updates list.`}
        maxLength={POST_SUMMARY_MAX}
        rows={3}
        error={errors.summary?.message}
        {...form.register('summary')}
      />
      <TextAreaField
        label="Text (optional)"
        hint="Use ## for a heading, **bold**, *italic*, - for a list, > for a quote and [words](https://link) for a link."
        maxLength={POST_BODY_MAX}
        rows={10}
        error={errors.body?.message}
        {...form.register('body')}
      />
      <div className="grid gap-6 sm:grid-cols-2">
        <TextField
          label="Event date (optional)"
          type="date"
          error={errors.eventDate?.message}
          {...form.register('eventDate')}
        />
        <TextField
          label="Link (optional)"
          type="url"
          placeholder="https://"
          error={errors.externalLink?.message}
          {...form.register('externalLink')}
        />
      </div>

      <ActingAsField
        orgAcronym={model.org.acronym}
        savedWith="the post and its images"
        error={errors.actingAs?.message}
        {...form.register('actingAs')}
      />

      <section aria-labelledby={`${coverInput}-label`} className="flex flex-col gap-3">
        <h2 id={`${coverInput}-label`} className="text-body font-medium text-ink">
          Cover image {type === 'HIGHLIGHT' ? '(shown in the carousel)' : '(optional)'}
        </h2>
        <p className="text-small text-ink-muted">
          {IMAGE_HINT} Without one, the carousel shows {model.org.acronym}’s logo.
        </p>
        {cover ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-sage/60 bg-white p-4 sm:flex-row">
            <img src={cover.url} alt="" className="aspect-[4/3] w-full rounded-xl object-cover sm:w-48" />
            <div className="flex flex-1 flex-col gap-3">
              <TextField
                label="Describe the image"
                maxLength={200}
                error={errors.cover?.message}
                {...form.register('cover.alt')}
              />
              <button
                type="button"
                onClick={() => form.setValue('cover', null, { shouldDirty: true })}
                className="tap-area inline-flex items-center gap-1 self-start text-small font-medium text-caution underline underline-offset-4"
              >
                <X aria-hidden="true" className="size-4" />
                Remove cover
              </button>
            </div>
          </div>
        ) : (
          <FilePick
            id={coverInput}
            label="Add a cover image"
            disabled={model.uploading}
            onFiles={(files) => files[0] && model.uploadCover(files[0])}
          />
        )}
      </section>

      <section aria-labelledby={`${galleryInput}-label`} className="flex flex-col gap-3">
        <h2 id={`${galleryInput}-label`} className="text-body font-medium text-ink">
          Gallery (optional, up to {POST_GALLERY_MAX})
        </h2>
        {gallery.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {gallery.map((image, i) => (
              <li key={image.key} className="flex flex-col gap-2 rounded-2xl border border-sage/60 bg-white p-3">
                <img src={image.url} alt="" className="aspect-[4/3] w-full rounded-xl object-cover" />
                <TextField
                  label={`Describe image ${i + 1}`}
                  maxLength={200}
                  error={errors.gallery?.[i]?.alt?.message}
                  {...form.register(`gallery.${i}.alt`)}
                />
                <button
                  type="button"
                  onClick={() =>
                    form.setValue(
                      'gallery',
                      gallery.filter((_, j) => j !== i),
                      { shouldDirty: true },
                    )
                  }
                  className="tap-area inline-flex items-center gap-1 self-start text-small font-medium text-caution underline underline-offset-4"
                >
                  <X aria-hidden="true" className="size-4" />
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {!model.galleryFull ? (
          <FilePick
            id={galleryInput}
            label="Add gallery images"
            multiple
            disabled={model.uploading}
            onFiles={model.addGalleryImages}
          />
        ) : null}
        {model.uploading ? (
          <p role="status" className="text-small text-ink-muted">
            Checking and uploading…
          </p>
        ) : null}
        {model.uploadError ? (
          <p role="alert" className="text-small text-destructive">
            {model.uploadError}
          </p>
        ) : null}
      </section>

      {!live ? (
        <TextField
          label="Publish later (Manila time, optional)"
          type="datetime-local"
          hint="Leave empty and choose Publish now, or pick a time and choose Schedule."
          error={errors.publishAt?.message}
          {...form.register('publishAt')}
        />
      ) : null}

      {model.saveError ? (
        <p role="alert" className="text-body text-destructive">
          {model.saveError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {live ? (
          <PillButton type="submit" disabled={model.saving}>
            {model.saving ? 'Saving…' : 'Save changes'}
          </PillButton>
        ) : (
          <>
            <PillButton type="submit" disabled={model.saving}>
              {model.saving ? 'Saving…' : 'Publish now'}
            </PillButton>
            <PillButton
              type="button"
              variant="light"
              className="border border-ink"
              disabled={model.saving}
              onClick={() => model.save('schedule')}
            >
              Schedule
            </PillButton>
            <PillButton
              type="button"
              variant="light"
              disabled={model.saving}
              onClick={() => model.save('draft')}
            >
              Save draft
            </PillButton>
          </>
        )}
      </div>
    </form>
  );
}

function FilePick({
  id,
  label,
  multiple = false,
  disabled,
  onFiles,
}: {
  id: string;
  label: string;
  multiple?: boolean;
  disabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  return (
    <div>
      <input
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple={multiple}
        disabled={disabled}
        className="peer sr-only"
        onChange={(event) => {
          onFiles([...(event.target.files ?? [])]);
          event.target.value = '';
        }}
      />
      <label
        htmlFor={id}
        className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border-[1.5px] border-dashed border-forest-500 bg-white px-5 text-body font-medium text-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-disabled:cursor-default peer-disabled:opacity-50"
      >
        <ImagePlus aria-hidden="true" className="size-5" />
        {label}
      </label>
    </div>
  );
}
