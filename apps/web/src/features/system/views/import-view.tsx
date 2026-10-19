import { Dialog } from 'radix-ui';
import { Download, FileUp, Play } from 'lucide-react';
import { PillButton } from '@/components/pill-button';
import { TextField } from '@/components/text-field';
import { FormAlert } from '@/features/auth/views/auth-layout';
import { cn } from '@/lib/utils';
import type { CsvImportModel, ImportRow } from '../presenters/use-csv-import';
import { ConfirmDialog, OVERLAY, PANEL, StepUpDialog } from './system-dialogs';
import { SystemLoading } from './system-layout';
import { Badge } from './users-view';

const COLUMNS = {
  bulk: 'organization, college, officer name, position, contact email, and optionally account email',
  'end-of-term': 'organization, officer name, position, contact email (and optionally college)',
};

function Row({ row }: { row: ImportRow }) {
  const tone = row.action === 'error' ? 'caution' : row.action === 'skip' ? 'plain' : 'forest';
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium break-words text-ink">
          <span className="text-small text-ink-muted tabular-nums">Line {row.line} · </span>
          {row.organization}
        </span>
        <Badge tone={tone}>{row.actionLabel}</Badge>
      </span>
      <span className="text-small break-all text-ink-muted">
        {row.officer} · {row.accountEmail}
      </span>
      {row.messages.length > 0 ? (
        <ul
          className={cn(
            'ml-4 list-disc text-small',
            row.action === 'error' ? 'text-destructive' : 'text-ink-muted',
          )}
        >
          {row.messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function IsscPasswordDialog({
  password,
  onClose,
}: {
  password: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog.Root open={password !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY} />
        <Dialog.Content className={PANEL}>
          <Dialog.Title className="text-h3 font-bold text-ink">
            Shown once: copy it now
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-body text-ink">
            The ISSC account&rsquo;s new temporary password. Hand it to the ISSC&rsquo;s incoming
            officer in charge; they reveal everyone else&rsquo;s from its notifications. It is not
            stored anywhere and cannot be shown again.
          </Dialog.Description>
          <code className="mt-4 block rounded-lg bg-surface px-3 py-2 font-mono text-lead tracking-wide break-all text-ink">
            {password}
          </code>
          <div className="mt-6 flex justify-end">
            <Dialog.Close asChild>
              <PillButton type="button">I copied it</PillButton>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** /system/accounts/bulk and /system/end-of-term */
export function ImportView({ model }: { model: CsvImportModel }) {
  const endOfTerm = model.kind === 'end-of-term';
  const counts = model.counts as Record<string, number> | null;
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-2xl bg-white p-5 ring-1 ring-border md:p-6">
        <p className="max-w-prose text-body text-ink">
          A CSV file whose first row names the columns: {COLUMNS[model.kind]}. Nothing is saved
          until you confirm the preview.
        </p>
        <div className="grid gap-5 md:grid-cols-2">
          <TextField
            label="CSV file"
            type="file"
            accept=".csv,text/csv"
            hint={model.file ? `Chosen: ${model.file}` : 'Up to 500 rows, 200 KB.'}
            error={model.fileError ?? undefined}
            onChange={(event) => void model.chooseFile(event.target.files?.[0] ?? null)}
          />
          {endOfTerm ? (
            <TextField
              label="Incoming term ends (optional)"
              type="date"
              value={model.termEnd}
              onChange={(event) => model.setTermEnd(event.target.value)}
            />
          ) : null}
        </div>
        <FormAlert message={model.checkError ?? undefined} />
      </section>

      {model.checking ? <SystemLoading label="Checking the file" /> : null}

      {model.stage !== 'empty' && counts ? (
        <section aria-labelledby="preview-heading" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 id="preview-heading" className="text-h3 font-bold text-ink">
              {model.stage === 'done' ? 'Done' : 'Preview'}
            </h2>
            <p aria-live="polite" className="text-body text-ink">
              {endOfTerm
                ? `${counts.assign} to reassign · ${counts.lock} to lock · ${counts.error} with errors`
                : `${counts.create} to create · ${counts.skip} skipped · ${counts.error} with errors`}
            </p>
          </div>

          {model.problems.length > 0 ? (
            <ul
              role="alert"
              className="flex flex-col gap-1 rounded-xl bg-caution-surface px-4 py-3 text-body text-caution"
            >
              {model.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}

          {model.stage === 'done' ? (
            <p className="rounded-xl bg-forest-500/10 px-4 py-3 text-body text-ink ring-1 ring-forest-500/20">
              {model.revealUntil
                ? `The temporary passwords went to the ISSC account's notifications as one handover list, behind a one-time Reveal (until ${model.revealUntil}). You do not see them.`
                : 'No other organization needed a new password.'}
            </p>
          ) : null}

          <ul
            aria-label="Rows"
            className="divide-y divide-border rounded-xl bg-white ring-1 ring-border"
          >
            {model.rows.map((row) => (
              <Row key={row.line} row={row} />
            ))}
          </ul>

          {endOfTerm && model.toLock.length > 0 ? (
            <section aria-labelledby="lock-heading" className="flex flex-col gap-2">
              <h3 id="lock-heading" className="text-body-lg font-semibold text-ink">
                {model.stage === 'done' ? 'Locked until assigned' : 'Will be locked until assigned'}
              </h3>
              <ul className="divide-y divide-border rounded-xl bg-white ring-1 ring-border">
                {model.toLock.map((l) => (
                  <li
                    key={l.email}
                    className="flex flex-wrap justify-between gap-x-4 px-4 py-2.5 text-body"
                  >
                    <span className="font-medium text-ink">{l.organization}</span>
                    <span className="text-small break-all text-ink-muted">{l.email}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            {model.stage === 'previewed' ? (
              <PillButton onClick={model.run} disabled={!model.runnable || model.running}>
                {endOfTerm ? <Play aria-hidden="true" /> : <FileUp aria-hidden="true" />}
                {model.running
                  ? 'Working…'
                  : endOfTerm
                    ? 'Run the end of term'
                    : `Create ${counts.create} ${counts.create === 1 ? 'account' : 'accounts'}`}
              </PillButton>
            ) : null}
            {model.stage === 'done' && !endOfTerm ? (
              <PillButton variant="light" onClick={model.downloadReport}>
                <Download aria-hidden="true" />
                Download the report
              </PillButton>
            ) : null}
          </div>
        </section>
      ) : null}

      <IsscPasswordDialog password={model.isscPassword} onClose={model.closeIsscPassword} />
      <ConfirmDialog confirming={model.confirming} onCancel={model.cancelConfirm} />
      <StepUpDialog {...model.stepUp} />
    </div>
  );
}
