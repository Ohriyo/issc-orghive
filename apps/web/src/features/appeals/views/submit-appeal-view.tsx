import { CheckCircle2, FileText, Loader2, ShieldAlert, X } from 'lucide-react';
import { UPLOAD_ACCEPT, APPEAL_REASON_MIN } from '@orghive/shared';
import { Container } from '@/components/container';
import { FileDropzone } from '@/components/file-dropzone';
import { TextAreaField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { OriginLink } from '@/navigation/origin-link';
import { ConfirmLeaveDialog } from '@/navigation/unsaved-changes-dialog';
import {
  ATTACHMENT_TYPES_LABEL,
  type AttachmentRow,
  type SubmitAppealModel,
} from '../presenters/use-submit-appeal';

type Ready = Extract<SubmitAppealModel, { status: 'ready' }>;

/** /dashboard/appeals/new: the reason and supporting files for an appeal. */
export function SubmitAppealView({ model }: { model: SubmitAppealModel }) {
  return (
    <div className="bg-surface-sweep min-h-page">
      <title>Submit an appeal | Orghive</title>
      <Container as="main" className="max-w-3xl pt-4 pb-section lg:pt-6">
        {model.status === 'loading' ? (
          <div aria-busy="true" aria-label="Loading" className="mt-8">
            <Skeleton className="h-12 w-72" />
            <Skeleton className="mt-8 h-80 w-full rounded-3xl" />
          </div>
        ) : model.status === 'error' ? (
          <>
            <h1 className="mt-8 text-h1 font-bold text-ink">Submit an appeal</h1>
            <SectionError
              className="mt-6"
              message="This form could not be loaded. Check your connection and try again."
              onRetry={model.retry}
            />
          </>
        ) : model.status === 'nothing' || model.status === 'forbidden' ? (
          <>
            <h1 className="mt-8 text-h1 font-bold text-ink">Submit an appeal</h1>
            <p className="mt-4 max-w-prose text-body-lg text-ink">
              {model.status === 'forbidden'
                ? `Only ${model.orgAcronym}'s officers submit its appeals.`
                : model.message}
            </p>
            {model.status === 'nothing' ? (
              <PillButton asChild variant="light" size="md" className="mt-6">
                <OriginLink to={model.href}>Go back</OriginLink>
              </PillButton>
            ) : null}
          </>
        ) : (
          <AppealForm model={model} />
        )}
      </Container>
    </div>
  );
}

function AppealForm({ model }: { model: Ready }) {
  const { form, target } = model;
  return (
    <>
      <ConfirmLeaveDialog
        open={model.leave.asking}
        onStay={model.leave.stay}
        onLeave={model.leave.go}
        title="Leave without submitting the appeal?"
        description="Your reason and files have not been sent."
      />
      <header className="mt-8">
        <h1 className="text-h1 font-bold text-ink">
          {target.kind === 'blocked' ? 'Appeal the block' : 'Appeal the freeze'}
        </h1>
        <p className="mt-2 text-lead break-words text-ink">{target.projectName}</p>
        <p className="mt-4 max-w-prose text-body text-pretty text-ink">{target.summary}</p>
        <p className="mt-2 max-w-prose text-body text-ink-muted">
          {target.deciderAcronym} decides this appeal. If it is approved, they set a new due date.
        </p>
        {target.lastRejection ? (
          <p className="mt-4 rounded-2xl bg-destructive/10 p-4 text-body break-words text-ink">
            <span className="font-semibold">Your last appeal was rejected.</span> Remarks:{' '}
            {target.lastRejection.remarks}
          </p>
        ) : null}
      </header>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          model.submit();
        }}
        className="mt-8 flex flex-col gap-6 rounded-3xl bg-white p-5 shadow-pool ring-1 ring-ink/10 md:p-8"
      >
        <TextAreaField
          label="Reason"
          rows={6}
          hint={`Explain why the deadline was missed and what you will do. At least ${APPEAL_REASON_MIN} characters.`}
          error={form.formState.errors.reason?.message}
          {...form.register('reason')}
        />
        <fieldset className="flex min-w-0 flex-col gap-3">
          <legend className="text-body font-medium text-ink">Supporting files (optional)</legend>
          {model.attachments.length > 0 ? (
            <ul aria-live="polite" className="flex flex-col gap-2">
              {model.attachments.map((row) => (
                <AttachmentLine key={row.key} row={row} />
              ))}
            </ul>
          ) : null}
          {model.canAddAttachment ? (
            <FileDropzone
              multiple
              accept={UPLOAD_ACCEPT}
              buttonLabel="Add files"
              hint={`${ATTACHMENT_TYPES_LABEL}. At most 5.`}
              onFiles={model.addFiles}
            />
          ) : (
            <p className="text-small text-ink-muted">You attached the most files allowed (5).</p>
          )}
        </fieldset>
        {model.saveError ? (
          <p role="alert" className="text-body font-medium text-destructive">
            {model.saveError}
          </p>
        ) : null}
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          {model.blockedReason ? (
            <p className="text-small text-ink-muted sm:text-right">{model.blockedReason}</p>
          ) : null}
          <PillButton
            type="submit"
            size="md"
            disabled={model.saving || model.blockedReason !== null}
            className="max-sm:w-full"
          >
            {model.saving ? 'Submitting…' : `Submit appeal to ${target.deciderAcronym}`}
          </PillButton>
        </div>
      </form>
    </>
  );
}

function AttachmentLine({ row }: { row: AttachmentRow }) {
  const state = row.state;
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-2">
      {state.status === 'clean' ? (
        <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-forest-700" />
      ) : state.status === 'refused' || state.status === 'error' ? (
        <ShieldAlert aria-hidden="true" className="size-5 shrink-0 text-destructive" />
      ) : state.status === 'checking' ? (
        <Loader2
          aria-hidden="true"
          className="size-5 shrink-0 animate-spin text-ink-muted motion-reduce:animate-none"
        />
      ) : (
        <FileText aria-hidden="true" className="size-5 shrink-0 text-ink-muted" />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-small font-medium break-all text-ink">
          {row.filename} <span className="font-normal text-ink-muted">({row.size})</span>
        </span>
        <span
          className={
            state.status === 'refused' || state.status === 'error'
              ? 'text-small text-destructive'
              : 'text-small text-ink-muted'
          }
        >
          {state.status === 'uploading'
            ? `Uploading ${state.progress}%`
            : state.status === 'checking'
              ? 'Checking for viruses…'
              : state.status === 'clean'
                ? 'Ready'
                : state.status === 'refused'
                  ? 'The virus scan refused this file. Remove it.'
                  : state.message}
        </span>
      </div>
      <button
        type="button"
        onClick={row.remove}
        aria-label={`Remove ${row.filename}`}
        className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink hover:bg-white focus-visible:bg-white"
      >
        <X aria-hidden="true" className="size-5" />
      </button>
    </li>
  );
}
