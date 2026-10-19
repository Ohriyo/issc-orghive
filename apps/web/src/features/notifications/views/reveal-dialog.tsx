import { useState } from 'react';
import { Dialog } from 'radix-ui';
import { Check, Copy, Download, Eye, KeyRound } from 'lucide-react';
import type { RevealEntry } from '@orghive/shared';
import { PillButton } from '@/components/pill-button';
import type { RevealState } from '../presenters/use-reveal';

const OVERLAY =
  'fixed inset-0 z-50 bg-ink/30 duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none';
const PANEL =
  'fixed top-1/2 left-1/2 z-50 max-h-[85dvh] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 shadow-pool-lift duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none';

function CopyPassword({ entry }: { entry: RevealEntry }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        void navigator.clipboard?.writeText(entry.temporaryPassword).then(() => setCopied(true))
      }
      className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink transition-colors hover:bg-surface focus-visible:bg-surface"
      aria-label={`Copy ${entry.organization.acronym}’s password`}
    >
      {copied ? (
        <Check aria-hidden="true" className="size-5" />
      ) : (
        <Copy aria-hidden="true" className="size-5" />
      )}
    </button>
  );
}

function Entries({ entries }: { entries: RevealEntry[] }) {
  return (
    <ul
      aria-label="Temporary passwords"
      className="mt-4 flex flex-col divide-y divide-border rounded-xl ring-1 ring-border"
    >
      {entries.map((entry) => (
        <li key={entry.email} className="flex flex-col gap-2 px-4 py-3">
          <span className="font-semibold text-ink">
            {entry.organization.acronym}
            <span className="block text-small font-normal break-all text-ink-muted">
              {entry.email}
            </span>
          </span>
          <span className="flex items-center gap-2">
            <code className="min-w-0 flex-1 rounded-lg bg-surface px-3 py-2 font-mono text-body-lg tracking-wide break-all text-ink">
              {entry.temporaryPassword}
            </code>
            <CopyPassword entry={entry} />
          </span>
          {entry.officerInCharge ? (
            <span className="text-small text-ink-muted">
              Hand to {entry.officerInCharge.name}, {entry.officerInCharge.position} (
              {entry.officerInCharge.email})
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** The one-time Reveal of temporary passwords, for the ISSC account. */
export function RevealDialog({
  state,
  onClose,
}: {
  state: RevealState | null;
  onClose: () => void;
}) {
  return (
    <Dialog.Root open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY} />
        <Dialog.Content className={PANEL}>
          <Dialog.Title className="flex items-center gap-2 text-h3 font-bold text-ink">
            <KeyRound aria-hidden="true" className="size-6 shrink-0 text-forest-500" />
            Temporary passwords
          </Dialog.Title>
          {state === null || state.status === 'loading' ? (
            <Dialog.Description className="mt-2 text-body text-ink-muted" aria-busy="true">
              Checking…
            </Dialog.Description>
          ) : state.status === 'available' ? (
            <>
              <Dialog.Description className="mt-2 text-body text-ink">
                {state.count === 1
                  ? 'One account’s password'
                  : `${state.count} accounts’ passwords`}{' '}
                {state.count === 1 ? 'is' : 'are'} waiting, until {state.until}. They are shown{' '}
                <strong>once</strong>: copy or download them right away, then hand each one to its
                officer in charge. Each must be changed at the first sign-in.
              </Dialog.Description>
              <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
                <Dialog.Close asChild>
                  <PillButton type="button" variant="light">
                    Not now
                  </PillButton>
                </Dialog.Close>
                <PillButton type="button" onClick={state.reveal} disabled={state.revealing}>
                  <Eye aria-hidden="true" />
                  {state.revealing ? 'Revealing…' : 'Reveal'}
                </PillButton>
              </div>
            </>
          ) : state.status === 'revealed' ? (
            <>
              <Dialog.Description className="mt-2 text-body text-ink">
                This is the only time they are shown. Orghive has already erased its copy.
              </Dialog.Description>
              <Entries entries={state.entries} />
              <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
                {state.entries.length > 1 ? (
                  <PillButton type="button" variant="light" onClick={state.download}>
                    <Download aria-hidden="true" />
                    Download as CSV
                  </PillButton>
                ) : null}
                <Dialog.Close asChild>
                  <PillButton type="button">I have handed them over</PillButton>
                </Dialog.Close>
              </div>
            </>
          ) : (
            <>
              <Dialog.Description className="mt-2 text-body text-ink">
                {state.message}
              </Dialog.Description>
              <div className="mt-6 flex justify-end">
                <Dialog.Close asChild>
                  <PillButton type="button" variant="light">
                    Close
                  </PillButton>
                </Dialog.Close>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
