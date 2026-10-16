import { ArrowLeft, CheckCircle2, FileText, TriangleAlert, X } from 'lucide-react';
import { Controller } from 'react-hook-form';
import { Link } from 'react-router';
import { UPLOAD_ACCEPT } from '@orghive/shared';
import { Container } from '@/components/container';
import { FileDropzone } from '@/components/file-dropzone';
import { SelectField, TextAreaField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { TextField } from '@/components/text-field';
import { cn } from '@/lib/utils';
import {
  ACCEPTED_TYPES_LABEL,
  tagsToText,
  textToTags,
  type UploadItem,
  type UploadModel,
  type UploadPageState,
} from '../presenters/use-upload-documents';

export type UploadViewProps = Exclude<UploadPageState, { status: 'not-found' }>;

const VISIBILITY = [
  { value: 'public', label: 'Public', hint: 'Anyone, without signing in' },
  { value: 'members', label: 'Signed-in users', hint: 'Anyone with an NwSSU account' },
  { value: 'private', label: 'Private', hint: 'Your organization, its approvers and admins' },
] as const;

const BACK_LINK =
  'tap-area inline-flex items-center gap-2 text-body font-medium text-ink underline decoration-1 underline-offset-4 transition-colors duration-300 hover:decoration-leaf focus-visible:decoration-leaf';

const sizeFormat = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 1 });
function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${sizeFormat.format(bytes / 1024)} KB`
    : `${sizeFormat.format(bytes / 1024 / 1024)} MB`;
}

/** /orgs/:slug/paperworks/upload: add one or more files to an organization's Paperworks. */
export function UploadView(props: UploadViewProps) {
  return (
    <div className="bg-surface-sweep min-h-dvh">
      <title>Upload Paperworks | Orghive</title>
      <Container as="main" className="max-w-4xl pt-6 pb-section lg:pt-10">
        {props.status === 'ready' ? (
          <UploadForm {...props} />
        ) : props.status === 'forbidden' ? (
          <>
            <Link to={props.org.href} className={BACK_LINK}>
              <ArrowLeft aria-hidden="true" className="size-4" />
              {props.org.acronym}
            </Link>
            <h1 className="mt-8 text-h1 font-bold text-ink">Upload Paperworks</h1>
            <p className="mt-4 max-w-prose text-body-lg text-ink">
              Only {props.org.acronym} officers can upload documents here. If you are one, ask an
              admin to add you to the organization.
            </p>
          </>
        ) : props.status === 'error' ? (
          <SectionError
            message="This page could not be loaded. Check your connection and try again."
            onRetry={props.retry}
          />
        ) : (
          <div aria-busy="true">
            <h1 className="sr-only">Loading</h1>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-8 h-12 w-72 max-w-full" />
            <Skeleton className="mt-8 h-48 w-full rounded-3xl" />
          </div>
        )}
      </Container>
    </div>
  );
}

function UploadForm(model: UploadModel) {
  const { org, items, rejected, isUploading, allDone } = model;
  const done = items.filter((item) => item.status === 'done').length;
  const failed = items.filter((item) => item.status === 'error').length;
  const rootError = model.form.formState.errors.documents?.root?.message;

  return (
    <>
      <Link to={org.paperworksHref} className={BACK_LINK}>
        <ArrowLeft aria-hidden="true" className="size-4" />
        {org.acronym} Paperworks
      </Link>
      <header className="mt-8 lg:mt-12">
        <h1 className="text-h1 font-bold text-ink">Upload Paperworks</h1>
        <p className="mt-2 text-lead text-ink">{org.name}</p>
        <p className="mt-4 max-w-prose text-body text-ink-muted">
          Each file becomes its own document and goes to review. It can be approved once its virus
          scan has passed.
        </p>
      </header>

      <FileDropzone
        className="mt-8"
        multiple
        accept={UPLOAD_ACCEPT}
        buttonLabel={items.length > 0 ? 'Add more files' : 'Choose files'}
        hint={ACCEPTED_TYPES_LABEL}
        onFiles={model.addFiles}
        disabled={isUploading}
      />

      {rejected.length > 0 ? (
        <div role="alert" className="mt-6 rounded-2xl border border-destructive/40 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium text-destructive">
              {rejected.length === 1 ? 'This file was not added:' : 'These files were not added:'}
            </p>
            <button
              type="button"
              onClick={model.dismissRejected}
              aria-label="Dismiss"
              className="-m-2.5 grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-muted hover:text-ink focus-visible:text-ink"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
          <ul className="mt-2 space-y-1 text-body text-ink">
            {rejected.map((file) => (
              <li key={file.name} className="break-words">
                <span className="font-medium">{file.name}</span>: {file.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form onSubmit={(event) => void model.onSubmit(event)} noValidate className="mt-8">
        {items.length > 0 ? (
          <ol className="space-y-6">
            {items.map((item, index) => (
              <FileCard
                key={`${item.file.name}-${index}`}
                model={model}
                item={item}
                index={index}
              />
            ))}
          </ol>
        ) : null}

        {rootError ? <p className="mt-4 font-medium text-destructive">{rootError}</p> : null}

        <p role="status" aria-live="polite" className="mt-6 text-body text-ink">
          {isUploading
            ? `Uploading ${done + 1} of ${items.length}…`
            : allDone
              ? `${done === 1 ? 'The document was' : `All ${done} documents were`} uploaded and sent for review.`
              : failed > 0
                ? `${failed} ${failed === 1 ? 'file' : 'files'} could not be uploaded. Fix them and try again.`
                : ''}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          {allDone ? (
            <PillButton asChild size="lg">
              <Link to={org.paperworksHref}>Back to Paperworks</Link>
            </PillButton>
          ) : (
            <PillButton type="submit" size="lg" disabled={items.length === 0 || isUploading}>
              {isUploading
                ? 'Uploading…'
                : items.length > 1
                  ? `Upload ${items.length} files`
                  : 'Upload file'}
            </PillButton>
          )}
        </div>
      </form>
    </>
  );
}

function FileCard({ model, item, index }: { model: UploadModel; item: UploadItem; index: number }) {
  const { form, options } = model;
  const errors = form.formState.errors.documents?.[index];
  const locked = item.status !== 'ready' && item.status !== 'error';
  const field = (name: string) => `documents.${index}.${name}` as const;

  return (
    <li className="rounded-3xl bg-white p-5 shadow-pool ring-1 ring-ink/10 sm:p-6">
      <div className="flex items-start gap-3">
        <FileText aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-forest-500" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold break-words text-ink">{item.file.name}</p>
          <p className="text-small text-ink-muted">{formatSize(item.file.size)}</p>
        </div>
        {item.status === 'ready' || item.status === 'error' ? (
          <button
            type="button"
            onClick={() => model.removeFile(index)}
            aria-label={`Remove ${item.file.name}`}
            className="-m-2.5 grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-muted transition-colors duration-300 hover:bg-surface hover:text-ink focus-visible:bg-surface focus-visible:text-ink"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        ) : null}
      </div>

      <UploadProgress item={item} />

      {item.status === 'done' ? null : (
        <fieldset disabled={locked} className="mt-5 grid gap-5 md:grid-cols-2">
          <legend className="sr-only">Details of {item.file.name}</legend>
          <TextField
            label="Title"
            className="md:col-span-2"
            error={errors?.title?.message}
            {...form.register(field('title') as 'documents.0.title')}
          />
          <SelectField
            label="Type"
            placeholder="Choose a type"
            options={options.types}
            error={errors?.typeId?.message}
            {...form.register(field('typeId') as 'documents.0.typeId')}
          />
          <SelectField
            label="Academic year"
            options={options.years}
            error={errors?.academicYear?.message}
            {...form.register(field('academicYear') as 'documents.0.academicYear')}
          />
          <SelectField
            label="Semester"
            placeholder="Not tied to a semester"
            options={options.semesters}
            error={errors?.semester?.message}
            {...form.register(field('semester') as 'documents.0.semester', {
              setValueAs: (value: string) => value || undefined,
            })}
          />
          <Controller
            control={form.control}
            name={field('tags') as 'documents.0.tags'}
            render={({ field: tags }) => (
              <TextField
                label="Tags"
                hint="Optional, separated by commas"
                error={errors?.tags?.message ?? errors?.tags?.[0]?.message}
                value={tagsToText(tags.value)}
                onChange={(event) => tags.onChange(textToTags(event.target.value))}
                onBlur={tags.onBlur}
              />
            )}
          />
          <TextAreaField
            label="Description"
            hint="Optional"
            className="md:col-span-2"
            error={errors?.description?.message}
            {...form.register(field('description') as 'documents.0.description')}
          />
          <fieldset className="md:col-span-2">
            <legend className="text-body font-medium text-ink">Who can see it once approved</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {VISIBILITY.map((choice) => (
                <label
                  key={choice.value}
                  className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border border-input bg-white p-3 transition-colors duration-300 hover:border-forest-500 has-checked:border-forest-500 has-checked:bg-accent has-focus-visible:outline-3 has-focus-visible:outline-ink"
                >
                  <input
                    type="radio"
                    value={choice.value}
                    className="mt-1 size-4 accent-forest-700"
                    {...form.register(field('visibility') as 'documents.0.visibility')}
                  />
                  <span>
                    <span className="block font-medium text-ink">{choice.label}</span>
                    <span className="block text-small text-ink-muted">{choice.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </fieldset>
      )}
    </li>
  );
}

function UploadProgress({ item }: { item: UploadItem }) {
  if (item.status === 'ready') return null;
  if (item.status === 'error') {
    return (
      <p role="alert" className="mt-4 flex items-start gap-2 text-body text-destructive">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        {item.error}
      </p>
    );
  }
  if (item.status === 'done') {
    return (
      <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-ink">
        <CheckCircle2 aria-hidden="true" className="size-5 text-forest-500" />
        Uploaded and sent for review.
        {item.documentHref ? (
          <Link
            to={item.documentHref}
            className="tap-area font-medium underline decoration-1 underline-offset-4 hover:decoration-leaf focus-visible:decoration-leaf"
          >
            Open document
          </Link>
        ) : null}
      </p>
    );
  }
  const label = item.status === 'saving' ? 'Saving…' : `Uploading ${item.progress}%`;
  return (
    <div className="mt-4">
      <div
        role="progressbar"
        aria-label={`Upload of ${item.file.name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={item.progress}
        aria-valuetext={label}
        className="h-2 overflow-hidden rounded-full bg-surface-deep"
      >
        <div
          className={cn(
            'bg-forest-band h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none',
            item.status === 'saving' && 'animate-pulse motion-reduce:animate-none',
          )}
          style={{ width: `${item.progress}%` }}
        />
      </div>
      <p className="mt-1 text-small text-ink-muted">{label}</p>
    </div>
  );
}
