import { Dialog } from 'radix-ui';
import { KeyRound, Lock, LogOut, Pencil, Power, Unlock } from 'lucide-react';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { TextField } from '@/components/text-field';
import { FormAlert } from '@/features/auth/views/auth-layout';
import { cn } from '@/lib/utils';
import type { FileRow, SystemAccountReady } from '../presenters/use-system-account';
import { ConfirmDialog, OVERLAY, PANEL, SECONDARY, StepUpDialog } from './system-dialogs';
import { SystemLoading } from './system-layout';
import { Badge, StandingBadge } from './users-view';

const SECTION = 'flex flex-col gap-3';
const H2 = 'text-h3 font-bold text-ink';
const PANEL_BOX = 'rounded-xl bg-white ring-1 ring-border';
const ROW_ACTION =
  'tap-area cursor-pointer rounded-sm text-small font-semibold whitespace-nowrap text-ink underline decoration-transparent decoration-1 underline-offset-4 transition-colors hover:decoration-ink focus-visible:decoration-ink disabled:cursor-default disabled:opacity-50';

function Summary({ model }: { model: SystemAccountReady }) {
  const { summary } = model;
  return (
    <section aria-label="Account" className={cn(PANEL_BOX, 'flex flex-col gap-4 p-5 md:p-6')}>
      <div className="flex flex-wrap items-center gap-2">
        <StandingBadge standing={summary.standing} />
        {summary.isSuperAdmin ? <Badge tone="forest">Super admin</Badge> : null}
        {summary.organization ? (
          <Badge tone="plain">
            {[summary.organization.type, summary.organization.college].filter(Boolean).join(' · ')}
          </Badge>
        ) : null}
      </div>
      {summary.lockReason ? (
        <p className="text-body text-ink">
          <span className="font-semibold">Locked:</span> {summary.lockReason}
        </p>
      ) : null}
      <dl className="grid gap-x-8 gap-y-3 text-body sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-small text-ink-muted">Organization</dt>
          <dd className="text-ink">
            {summary.organization?.name ?? 'None (personal console account)'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-small text-ink-muted">Sign-in email</dt>
          <dd className="break-all text-ink">{summary.email}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-small text-ink-muted">Officer in charge</dt>
          <dd className="text-ink">
            {summary.officer ? (
              <>
                {summary.officer.name}, {summary.officer.position}
                <span className="block text-small break-all text-ink-muted">
                  {summary.officer.email}
                </span>
              </>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div>
          <dt className="text-small text-ink-muted">Last sign-in</dt>
          <dd className="text-ink">{summary.lastLogin}</dd>
        </div>
      </dl>
    </section>
  );
}

function Actions({ model }: { model: SystemAccountReady }) {
  const a = model.actions;
  return (
    <div role="group" aria-label="Account actions" className="flex flex-wrap gap-3">
      {a.canEdit ? (
        <PillButton variant="light" onClick={a.edit}>
          <Pencil aria-hidden="true" />
          Edit details
        </PillButton>
      ) : null}
      {a.canReset ? (
        <PillButton variant="light" onClick={a.reset} disabled={a.busy}>
          <KeyRound aria-hidden="true" />
          Issue new password
        </PillButton>
      ) : null}
      {a.canSignOut ? (
        <PillButton variant="light" onClick={a.signOut} disabled={a.busy}>
          <LogOut aria-hidden="true" />
          Sign out everywhere
        </PillButton>
      ) : null}
      {a.canLock ? (
        <PillButton variant="light" onClick={a.lock} disabled={a.busy}>
          <Lock aria-hidden="true" />
          Lock
        </PillButton>
      ) : null}
      {a.canUnlock ? (
        <PillButton variant="light" onClick={a.unlock} disabled={a.busy}>
          <Unlock aria-hidden="true" />
          Unlock
        </PillButton>
      ) : null}
      {a.canDeactivate ? (
        <PillButton variant="light" onClick={a.deactivate} disabled={a.busy}>
          <Power aria-hidden="true" />
          Deactivate
        </PillButton>
      ) : null}
      {a.canReactivate ? (
        <PillButton variant="light" onClick={a.reactivate} disabled={a.busy}>
          <Power aria-hidden="true" />
          Reactivate
        </PillButton>
      ) : null}
    </div>
  );
}

function SimpleList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: { key: string; primary: React.ReactNode; secondary?: React.ReactNode }[];
}) {
  return (
    <section className={SECTION}>
      <h2 className={H2}>{title}</h2>
      {items.length === 0 ? (
        <p className={cn(PANEL_BOX, 'px-5 py-4 text-body text-ink-muted')}>{empty}</p>
      ) : (
        <ul className={cn(PANEL_BOX, 'divide-y divide-border')}>
          {items.map((item) => (
            <li key={item.key} className="flex flex-col gap-0.5 px-5 py-3">
              <span className="text-body text-ink">{item.primary}</span>
              {item.secondary ? (
                <span className="text-small break-all text-ink-muted">{item.secondary}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FileActions({ row, model }: { row: FileRow; model: SystemAccountReady }) {
  const busy = model.support.pendingId === row.id;
  return (
    <span className="flex gap-x-6">
      {row.canRescan ? (
        <button
          type="button"
          className={ROW_ACTION}
          disabled={busy}
          aria-label={`Scan again: ${row.title}`}
          onClick={() => model.support.rescan(row.id)}
        >
          Scan again
        </button>
      ) : null}
      {row.canRestore ? (
        <button
          type="button"
          className={ROW_ACTION}
          disabled={busy}
          aria-label={`Restore: ${row.title}`}
          onClick={() => model.support.restore(row.id)}
        >
          Restore
        </button>
      ) : null}
    </span>
  );
}

function Files({ model }: { model: SystemAccountReady }) {
  const files = model.files;
  if (!files) return null;
  return (
    <section className={SECTION} aria-labelledby="files-heading">
      <h2 id="files-heading" className={H2}>
        Files
      </h2>
      <p className="max-w-prose text-body text-ink-muted">
        Details only: files cannot be opened or downloaded here, and private files&rsquo; titles
        stay hidden.
      </p>
      {files.status === 'loading' ? (
        <SystemLoading label="Loading files" />
      ) : files.status === 'error' ? (
        <SectionError message="The files could not be loaded." onRetry={files.retry} />
      ) : files.rows.length === 0 ? (
        <p className={cn(PANEL_BOX, 'px-5 py-4 text-body text-ink-muted')}>No files yet.</p>
      ) : (
        <ul aria-label="Files" className={cn(PANEL_BOX, 'divide-y divide-border')}>
          {files.rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="flex min-w-0 flex-col">
                <span className={cn('break-words text-ink', row.hidden && 'italic text-ink-muted')}>
                  {row.title}
                </span>
                <span className="text-small text-ink-muted">
                  {[row.type, row.visibility, row.size, `updated ${row.updated}`].join(' · ')}
                </span>
                <span className="mt-1 flex flex-wrap gap-1.5">
                  <Badge tone={row.stuck ? 'caution' : 'plain'}>{row.status}</Badge>
                  {row.isTestData ? <Badge tone="caution">Test data</Badge> : null}
                </span>
              </span>
              <FileActions row={row} model={model} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EditDialog({ dialog }: { dialog: SystemAccountReady['editDialog'] }) {
  const errors = dialog.errors;
  return (
    <Dialog.Root open={dialog.open} onOpenChange={(open) => !open && dialog.onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY} />
        <Dialog.Content className={cn(PANEL, 'w-[min(36rem,calc(100vw-2rem))]')}>
          <Dialog.Title className="text-h3 font-bold text-ink">Edit account details</Dialog.Title>
          <Dialog.Description className="mt-2 text-body text-ink">
            A different officer name starts a new officer term; other changes correct the current
            one.
          </Dialog.Description>
          <form
            noValidate
            onSubmit={(event) => void dialog.onSubmit(event)}
            className="mt-5 flex flex-col gap-5"
          >
            <FormAlert message={dialog.formError} />
            <TextField
              label="Sign-in email"
              type="email"
              error={errors.email?.message}
              {...dialog.register('email')}
            />
            <TextField
              label="Officer in charge"
              error={errors.officerInCharge?.name?.message}
              {...dialog.register('officerInCharge.name')}
            />
            <TextField
              label="Position"
              error={errors.officerInCharge?.position?.message}
              {...dialog.register('officerInCharge.position')}
            />
            <TextField
              label="Contact email"
              type="email"
              error={errors.officerInCharge?.email?.message}
              {...dialog.register('officerInCharge.email')}
            />
            <TextField label="Term ends (optional)" type="date" {...dialog.register('termEnd')} />
            <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-3">
              <Dialog.Close className={SECONDARY}>Cancel</Dialog.Close>
              <PillButton type="submit" disabled={dialog.isSubmitting}>
                {dialog.isSubmitting ? 'Saving…' : 'Save'}
              </PillButton>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function LockDialog({ dialog }: { dialog: SystemAccountReady['lockDialog'] }) {
  return (
    <Dialog.Root open={dialog.open} onOpenChange={(open) => !open && dialog.onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY} />
        <Dialog.Content className={PANEL}>
          <Dialog.Title className="text-h3 font-bold text-ink">Lock this account?</Dialog.Title>
          <Dialog.Description className="mt-2 text-body text-ink">
            A temporary hold: every session ends and it cannot sign in until unlocked. The reason is
            audited.
          </Dialog.Description>
          <form
            noValidate
            onSubmit={(event) => void dialog.onSubmit(event)}
            className="mt-5 flex flex-col gap-5"
          >
            <FormAlert message={dialog.formError} />
            <TextField
              label="Reason"
              autoFocus
              error={dialog.errors.reason?.message}
              {...dialog.register('reason')}
            />
            <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-3">
              <Dialog.Close className={SECONDARY}>Cancel</Dialog.Close>
              <PillButton type="submit" disabled={dialog.isSubmitting}>
                {dialog.isSubmitting ? 'Locking…' : 'Lock account'}
              </PillButton>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ShownPasswordDialog({
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
            The ISSC account&rsquo;s new temporary password. It is not stored anywhere and cannot be
            shown again; it must be changed at the next sign-in.
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

/** /system/users/:id, once loaded. */
export function AccountView({ model }: { model: SystemAccountReady }) {
  const { history } = model;
  return (
    <div className="flex flex-col gap-8">
      <Summary model={model} />
      <Actions model={model} />
      <div className="grid gap-8 xl:grid-cols-2">
        <SimpleList
          title="Officer terms"
          empty="No officer terms recorded."
          items={history.terms.map((t, i) => ({
            key: String(i),
            primary: (
              <>
                {t.officer}
                {t.current ? <span className="text-ink-muted"> (current)</span> : null}
              </>
            ),
            secondary: `${t.span} · ${t.email}`,
          }))}
        />
        <SimpleList
          title="Recent sign-ins"
          empty="No sign-ins yet."
          items={history.logins.map((l, i) => ({
            key: String(i),
            primary: `${l.result}, ${l.when}`,
            secondary: l.from,
          }))}
        />
        <SimpleList
          title="Active sessions"
          empty="No active sessions."
          items={history.sessions.map((s) => ({
            key: s.id,
            primary: `Since ${s.started}`,
            secondary: `Until ${s.until} · ${s.ip}`,
          }))}
        />
        <SimpleList
          title="Audit trail"
          empty="Nothing audited yet."
          items={history.audit.map((a) => ({
            key: a.id,
            primary: a.action,
            secondary: `${a.when} · by ${a.by}`,
          }))}
        />
      </div>
      <Files model={model} />

      <EditDialog dialog={model.editDialog} />
      <LockDialog dialog={model.lockDialog} />
      <ShownPasswordDialog password={model.shownPassword} onClose={model.closeShownPassword} />
      <ConfirmDialog confirming={model.confirming} onCancel={model.cancelConfirm} />
      <StepUpDialog {...model.stepUp} />
    </div>
  );
}
