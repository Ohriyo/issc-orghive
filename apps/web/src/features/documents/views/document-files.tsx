import { useState } from 'react';
import { Download, FileText, ShieldAlert, ShieldCheck } from 'lucide-react';
import { UPLOAD_ACCEPT, type DocumentVersion } from '@orghive/shared';
import { FileDropzone } from '@/components/file-dropzone';
import { Skeleton } from '@/components/skeleton';
import { ACCEPTED_TYPES_LABEL } from '@/features/uploads/presenters/use-upload-documents';
import { cn } from '@/lib/utils';
import type { DocumentFilesModel } from '../presenters/use-document-files';

const dateFormat = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' });
const sizeFormat = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 1 });

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${sizeFormat.format(bytes / 1024)} KB`
    : `${sizeFormat.format(bytes / 1024 / 1024)} MB`;
}

const SCAN_LABEL: Record<DocumentVersion['scanStatus'], string> = {
  pending: 'Checking for viruses…',
  clean: 'Passed the virus scan',
  infected: 'Blocked: a virus was found',
  invalid: 'Blocked: not the file type it claimed',
};

/** Every version of the document, newest first; clean ones can be downloaded. */
export function DocumentFiles({ files }: { files: DocumentFilesModel }) {
  const [downloadError, setDownloadError] = useState<string>();

  return (
    <section aria-labelledby="files-heading" className="mt-10">
      <h2 id="files-heading" className="text-h3 font-bold text-ink">
        Files
      </h2>
      {files.versionsError ? (
        <p role="alert" className="mt-4 text-body text-ink">
          The files could not be loaded. Reload the page to try again.
        </p>
      ) : !files.versions ? (
        <div aria-busy="true" className="mt-4 space-y-3">
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      ) : files.versions.length === 0 ? (
        <p className="mt-4 text-body text-ink">No file is available for this document yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {files.versions.map((version) => (
            <li
              key={version.id}
              className={cn(
                'flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl bg-white p-4 ring-1 ring-ink/10',
                version.isCurrent && 'ring-2 ring-forest-500',
              )}
            >
              <FileText aria-hidden="true" className="size-6 shrink-0 text-forest-500" />
              <div className="min-w-48 flex-1">
                <p className="font-semibold break-words text-ink">
                  Version {version.version}
                  {version.isCurrent ? (
                    <span className="font-normal text-ink-muted">, current</span>
                  ) : null}
                </p>
                <p className="text-small break-words text-ink-muted">
                  {version.originalFilename}, {formatSize(version.sizeBytes)},{' '}
                  {dateFormat.format(new Date(version.createdAt))}
                </p>
                <p
                  className={cn(
                    'mt-1 flex items-center gap-1.5 text-small',
                    version.scanStatus === 'clean' ? 'text-ink-muted' : 'font-medium text-ink',
                    (version.scanStatus === 'infected' || version.scanStatus === 'invalid') &&
                      'text-destructive',
                  )}
                >
                  {version.scanStatus === 'clean' ? (
                    <ShieldCheck aria-hidden="true" className="size-4" />
                  ) : (
                    <ShieldAlert aria-hidden="true" className="size-4" />
                  )}
                  {SCAN_LABEL[version.scanStatus]}
                </p>
              </div>
              {version.scanStatus === 'clean' ? (
                <button
                  type="button"
                  onClick={() => void files.download(version.id).then(setDownloadError)}
                  className="bg-forest-band inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full px-5 font-medium text-white shadow-pool transition-[filter] duration-300 hover:brightness-110 focus-visible:brightness-110 max-sm:w-full"
                >
                  <Download aria-hidden="true" className="size-5" />
                  Download
                  <span className="sr-only"> version {version.version}</span>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {downloadError ? (
        <p role="alert" className="mt-3 text-body text-destructive">
          {downloadError}
        </p>
      ) : null}

      {files.canReupload ? <Reupload files={files} /> : null}
    </section>
  );
}

function Reupload({ files }: { files: DocumentFilesModel }) {
  const state = files.reupload;
  const busy = state.status === 'uploading' || state.status === 'saving';
  return (
    <div className="mt-8">
      <h3 className="text-body-lg font-semibold text-ink">Upload a new version</h3>
      <p className="mt-1 max-w-prose text-body text-ink-muted">
        The current version stays until the new one passes the virus scan; then the document goes
        back to review. Older versions stay available.
      </p>
      <FileDropzone
        className="mt-4"
        accept={UPLOAD_ACCEPT}
        buttonLabel="Choose a file"
        hint={ACCEPTED_TYPES_LABEL}
        disabled={busy}
        onFiles={(picked) => void files.uploadVersion(picked[0]!)}
      />
      <div aria-live="polite" className="mt-3">
        {state.status === 'uploading' || state.status === 'saving' ? (
          <div>
            <div
              role="progressbar"
              aria-label={`Upload of ${state.filename}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={state.status === 'saving' ? 100 : state.progress}
              className="h-2 overflow-hidden rounded-full bg-surface-deep"
            >
              <div
                className="bg-forest-band h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${state.status === 'saving' ? 100 : state.progress}%` }}
              />
            </div>
            <p className="mt-1 text-small text-ink-muted">
              {state.status === 'saving' ? 'Saving…' : `Uploading ${state.progress}%`}
            </p>
          </div>
        ) : state.status === 'done' ? (
          <p className="text-body text-ink">
            {state.filename} was uploaded. It becomes the current version once its virus scan
            passes.
          </p>
        ) : state.status === 'error' ? (
          <p role="alert" className="text-body text-destructive">
            {state.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
