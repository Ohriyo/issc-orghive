import { CONSTITUTION_NOTE_MAX } from '@orghive/shared';
import { FileDropzone } from '@/components/file-dropzone';
import { TextAreaField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { TextField } from '@/components/text-field';
import { cn } from '@/lib/utils';
import { OriginLink } from '@/navigation/origin-link';
import type { ConstitutionEditorModel } from '../presenters/use-constitution-upload';

const LINK =
  'tap-area font-medium text-ink underline decoration-1 underline-offset-4 hover:decoration-leaf focus-visible:decoration-leaf';

/**
 * The Constitution & By-laws in the profile editor: what is on record, and the upload of
 * the adopted text or an amendment. It is its own action (not part of Save changes):
 * always public, view-only for everyone else, and never removed, only amended.
 */
export function ConstitutionEditor({
  model,
  acronym,
  className,
}: {
  model: ConstitutionEditorModel;
  acronym: string;
  className?: string;
}) {
  return (
    <section
      id="constitution"
      aria-labelledby="constitution-edit-heading"
      className={cn('scroll-mt-28', className)}
    >
      <h2 id="constitution-edit-heading" className="text-h3 font-bold text-ink">
        Constitution &amp; By-laws
      </h2>
      <p className="mt-2 max-w-prose text-body text-ink-muted">
        Always public and view only: visitors read the pages, only {acronym} can download the
        file. Amendments keep every earlier version in its history. Uploads here save right
        away, apart from Save changes.
      </p>
      {model.status === 'loading' ? (
        <div aria-busy="true" className="mt-6">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="mt-6 h-40 w-full rounded-2xl" />
        </div>
      ) : model.status === 'error' ? (
        <SectionError
          className="mt-6"
          message="The Constitution & By-laws could not be loaded. Check your connection and try again."
          onRetry={model.retry}
        />
      ) : (
        <Ready model={model} />
      )}
    </section>
  );
}

function Ready({ model }: { model: Extract<ConstitutionEditorModel, { status: 'ready' }> }) {
  const busy = model.step.status === 'uploading' || model.step.status === 'saving';
  return (
    <>
      {model.exists ? (
        <div className="mt-6">
          <p className="text-body text-ink">
            {model.dateLine ?? 'On record.'}{' '}
            {model.readHref ? (
              <OriginLink to={model.readHref} className={LINK}>
                Open it
              </OriginLink>
            ) : null}
          </p>
          <ol className="mt-4">
            {model.history.map((entry) => (
              <li key={entry.id} className="border-t border-ink/10 py-3 first:border-t-0">
                <p className="text-body font-semibold text-ink">
                  {entry.label}
                  {entry.isCurrent ? (
                    <span className="ml-2 text-small font-normal text-ink-muted">Current</span>
                  ) : null}
                </p>
                {entry.state === 'scanning' ? (
                  <p className="text-small text-caution">Checking for viruses…</p>
                ) : entry.state === 'refused' ? (
                  <p className="text-small font-medium text-destructive">
                    Refused by the virus scan. Upload a clean copy.
                  </p>
                ) : null}
                {entry.note ? (
                  <p className="mt-1 text-small whitespace-pre-line text-ink">{entry.note}</p>
                ) : null}
                {entry.actingAs ? (
                  <p className="mt-1 text-small text-ink-muted">Uploaded by {entry.actingAs}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="mt-6 rounded-2xl bg-surface px-5 py-4 text-body text-ink">
          Not uploaded yet. Your page says so until you add it.
        </p>
      )}

      <div className="mt-6 flex flex-col gap-5 rounded-2xl bg-surface p-5 md:p-6">
        <h3 className="text-body-lg font-semibold text-ink">
          {model.exists ? 'Upload an amendment' : 'Upload the constitution'}
        </h3>
        <FileDropzone
          accept={model.accept}
          buttonLabel={model.file ? 'Choose another file' : 'Choose the file'}
          hint={model.file ? model.file.name : 'PDF, DOCX, XLSX, PPTX, JPG or PNG, up to 25 MB'}
          onFiles={(files) => model.setFile(files[0] ?? null)}
          disabled={busy}
        />
        {model.fileError ? (
          <p role="alert" className="-mt-2 text-small font-medium text-destructive">
            {model.fileError}
          </p>
        ) : null}
        <TextField
          label={model.exists ? 'Date amended' : 'Date adopted'}
          type="date"
          max={model.today}
          value={model.amendedOn}
          onChange={(event) => model.setAmendedOn(event.target.value)}
          hint="The date it was ratified, which may be before today."
          className="max-w-xs"
        />
        <TextAreaField
          label={model.exists ? 'What changed' : 'Note (optional)'}
          required={model.exists}
          rows={3}
          maxLength={CONSTITUTION_NOTE_MAX}
          value={model.note}
          onChange={(event) => model.setNote(event.target.value)}
          hint={
            model.exists
              ? 'Shown in the amendment history, e.g. “Article III: adds two officer seats.”'
              : undefined
          }
        />
        <div className="flex flex-wrap items-center gap-4">
          <PillButton type="button" onClick={model.upload} disabled={busy}>
            {model.step.status === 'uploading'
              ? `Uploading… ${model.step.progress}%`
              : model.step.status === 'saving'
                ? 'Saving…'
                : model.exists
                  ? 'Upload amendment'
                  : 'Upload constitution'}
          </PillButton>
          {model.step.status === 'error' ? (
            <p role="alert" className="text-small font-medium text-destructive">
              {model.step.message}
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}
