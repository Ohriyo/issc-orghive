import { ActingAsField } from '@/components/acting-as-field';
import { FileDropzone } from '@/components/file-dropzone';
import { SelectField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { OriginLink } from '@/navigation/origin-link';
import type { HandbookAdminModel } from '../presenters/use-handbook-admin';

type Ready = Extract<HandbookAdminModel, { status: 'ready' }>;

const LINK =
  'tap-area font-medium text-ink underline decoration-1 underline-offset-4 hover:decoration-leaf focus-visible:decoration-leaf';
const dateTime = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
const STATE_LABEL = {
  checking: 'Checking for viruses…',
  refused: 'Refused by the virus scan',
  preparing: 'Preparing the pages…',
  ready: 'Ready',
} as const;

/** /admin/handbook: upload an edition (or a new version of one) and choose the current one. */
export function HandbookAdminView({ model }: { model: HandbookAdminModel }) {
  if (model.status === 'loading') {
    return (
      <div aria-busy="true">
        <h1 className="text-h2 font-bold text-ink">Student Handbook</h1>
        <Skeleton className="mt-6 h-64 w-full rounded-3xl" />
      </div>
    );
  }
  if (model.status === 'error') {
    return (
      <>
        <h1 className="text-h2 font-bold text-ink">Student Handbook</h1>
        <SectionError
          className="mt-6"
          message="The handbook editions could not be loaded. Check your connection and try again."
          onRetry={model.retry}
        />
      </>
    );
  }
  return <Ready model={model} />;
}

function Ready({ model }: { model: Ready }) {
  const busy = model.step.status === 'uploading' || model.step.status === 'saving';
  const chosen = model.years.find((y) => y.value === model.year);
  return (
    <>
      <header className="max-w-prose">
        <h1 className="text-h2 font-bold text-ink">Student Handbook</h1>
        <p className="mt-2 text-body text-ink-muted">
          One PDF per academic year, read by everyone at{' '}
          <OriginLink to="/handbook" className={LINK}>
            /handbook
          </OriginLink>{' '}
          (view only; only this account can download it). Editions are never removed: a mistake
          is fixed by uploading a corrected version of that year.
        </p>
      </header>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <section aria-labelledby="editions-heading" className="min-w-0">
          <h2 id="editions-heading" className="text-h3 font-bold text-ink">
            Editions
          </h2>
          {model.currentError ? (
            <p role="alert" className="mt-3 text-small font-medium text-destructive">
              {model.currentError}
            </p>
          ) : null}
          {model.editions.length === 0 ? (
            <p className="mt-4 rounded-2xl bg-white px-5 py-4 text-body text-ink ring-1 ring-ink/10">
              No edition yet. The first one you upload becomes the current Student Handbook.
            </p>
          ) : (
            <ol className="mt-4 flex flex-col gap-4">
              {model.editions.map((edition) => (
                <li
                  key={edition.academicYear}
                  className="rounded-3xl bg-white p-5 shadow-pool ring-1 ring-ink/10 md:p-6"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-body-lg font-semibold text-ink">
                      {edition.yearLabel}
                      {edition.isCurrent ? (
                        <span className="ml-3 inline-block rounded-full bg-forest-700 px-3 py-0.5 align-middle text-small font-semibold text-white">
                          Current
                        </span>
                      ) : null}
                    </h3>
                    <div className="flex flex-wrap items-center gap-3">
                      {edition.readable ? (
                        <OriginLink to={edition.readHref} className={LINK}>
                          Open
                        </OriginLink>
                      ) : null}
                      {!edition.isCurrent ? (
                        <PillButton
                          variant="light"
                          disabled={!edition.readable || model.makingCurrent !== null}
                          onClick={() => model.makeCurrent(edition.academicYear)}
                        >
                          {model.makingCurrent === edition.academicYear ? 'Making current…' : 'Make current'}
                        </PillButton>
                      ) : null}
                    </div>
                  </div>
                  {!edition.readable ? (
                    <p className="mt-2 text-small text-ink-muted">
                      It can be read, and made current, once its file passes the virus scan.
                    </p>
                  ) : null}
                  <ol className="mt-4">
                    {edition.versions.map((v) => (
                      <li
                        key={v.id}
                        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-ink/10 py-3 text-small"
                      >
                        <span className="text-ink">
                          <span className="font-semibold">Version {v.version}</span>
                          {v.isCurrent ? <span className="text-ink-muted"> (shown to readers)</span> : null}
                          <span className="block text-ink-muted">
                            {dateTime.format(new Date(v.uploadedAt))}
                            {v.actingAs ? `, by ${v.actingAs}` : ''}
                          </span>
                        </span>
                        <span
                          className={
                            v.state === 'refused'
                              ? 'font-medium text-destructive'
                              : v.state === 'ready'
                                ? 'text-ink'
                                : 'text-caution'
                          }
                        >
                          {STATE_LABEL[v.state]}
                        </span>
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section
          aria-labelledby="upload-heading"
          className="flex flex-col gap-5 rounded-3xl bg-white p-5 shadow-pool ring-1 ring-ink/10 md:p-6 lg:sticky lg:top-[calc(var(--header-h)+1.5rem)]"
        >
          <h2 id="upload-heading" className="text-h3 font-bold text-ink">
            Upload
          </h2>
          <SelectField
            label="Academic year"
            value={model.year}
            onChange={(event) => model.setYear(event.target.value)}
            options={model.years.map((y) => ({
              value: y.value,
              label: y.hasEdition ? `${y.label} (new version)` : y.label,
            }))}
            hint={
              chosen?.hasEdition
                ? 'This year has an edition: the upload becomes its next version.'
                : 'A new edition. It becomes current only if it is the first, or when you make it current.'
            }
          />
          <FileDropzone
            accept=".pdf"
            buttonLabel={model.file ? 'Choose another PDF' : 'Choose the PDF'}
            hint={model.file ? model.file.name : 'PDF only, up to 25 MB. Bookmarks become its contents.'}
            onFiles={(files) => model.setFile(files[0] ?? null)}
            disabled={busy}
          />
          {model.fileError ? (
            <p role="alert" className="-mt-2 text-small font-medium text-destructive">
              {model.fileError}
            </p>
          ) : null}
          <ActingAsField
            orgAcronym="ISSC"
            value={model.actingAs.value}
            onChange={(event) => model.actingAs.onChange(event.target.value)}
            error={model.actingAs.error}
          />
          <div className="flex flex-wrap items-center gap-4">
            <PillButton onClick={model.upload} disabled={busy}>
              {model.step.status === 'uploading'
                ? `Uploading… ${model.step.progress}%`
                : model.step.status === 'saving'
                  ? 'Saving…'
                  : 'Upload'}
            </PillButton>
            {model.step.status === 'error' ? (
              <p role="alert" className="text-small font-medium text-destructive">
                {model.step.message}
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}
