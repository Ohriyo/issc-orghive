import { useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { HexFrame } from '@/components/hex-frame';
import { OrgLogo } from '@/components/org-logo';
import { cn } from '@/lib/utils';
import type { OrgRef } from '../presenters/use-dashboard';

export interface OrgSwitcherProps {
  organizations: OrgRef[];
  selectedId: string;
  onSelect: (id: string) => void;
  className?: string;
}

/** A small hexagon with the logo. Without a logo it stays a plain hexagon: initials at this size only blur. */
function MiniSeal({ org, className }: { org: OrgRef; className?: string }) {
  if (!org.logoUrl) {
    return (
      <HexFrame
        band={false}
        ring={false}
        shadow={false}
        className={cn('w-8 shrink-0', className)}
      />
    );
  }
  return (
    <HexFrame
      band={false}
      ring={false}
      shadow={false}
      className={cn('w-8 shrink-0', className)}
      contentClassName="p-[12%]"
    >
      <OrgLogo
        name={org.name}
        src={org.logoUrl}
        srcSet={org.logoSrcSet ?? undefined}
        sizes="2rem"
        alt=""
        fallbackText={org.acronym}
        className="size-full"
      />
    </HexFrame>
  );
}

/**
 * Shown only to people in more than one organization. From md a row of pills (the
 * pressed one is current); on phones one pill opens a bottom sheet listing them.
 */
export function OrgSwitcher({ organizations, selectedId, onSelect, className }: OrgSwitcherProps) {
  const [open, setOpen] = useState(false);
  const selected = organizations.find((o) => o.id === selectedId) ?? organizations[0]!;

  return (
    <div className={className}>
      <div role="group" aria-label="Your organizations" className="hidden flex-wrap gap-3 md:flex">
        {organizations.map((org) => {
          const current = org.id === selectedId;
          return (
            <button
              key={org.id}
              type="button"
              aria-pressed={current}
              onClick={() => onSelect(org.id)}
              className={cn(
                'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full py-1.5 pr-5 pl-2 text-body font-semibold shadow-pool ring-1 transition-colors duration-300',
                current
                  ? 'bg-forest-band text-white ring-transparent'
                  : 'bg-white text-ink ring-ink/10 hover:bg-pill-light focus-visible:bg-pill-light',
              )}
            >
              <MiniSeal org={org} />
              {org.acronym}
            </button>
          );
        })}
      </div>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger
          aria-label={`Switch organization, current: ${selected.acronym}`}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-white py-1.5 pr-4 pl-2 text-body font-semibold text-ink shadow-pool ring-1 ring-ink/10 md:hidden"
        >
          <MiniSeal org={selected} />
          {selected.acronym}
          <ChevronsUpDown aria-hidden="true" className="size-4 text-ink-muted" />
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40 duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-3xl bg-white px-gutter pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] shadow-pool-lift duration-300 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom motion-reduce:animate-none"
          >
            <div
              aria-hidden="true"
              className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-surface-deep"
            />
            <div className="mb-4 flex items-center justify-between">
              <Dialog.Title className="text-h3 font-bold text-ink">Your organizations</Dialog.Title>
              <Dialog.Close
                aria-label="Close"
                className="grid size-11 cursor-pointer place-items-center rounded-full text-ink transition-colors duration-300 hover:bg-surface focus-visible:bg-surface"
              >
                <X aria-hidden="true" className="size-6" />
              </Dialog.Close>
            </div>
            <ul className="flex flex-col gap-1">
              {organizations.map((org) => {
                const current = org.id === selectedId;
                return (
                  <li key={org.id}>
                    <button
                      type="button"
                      aria-current={current ? 'true' : undefined}
                      onClick={() => {
                        onSelect(org.id);
                        setOpen(false);
                      }}
                      className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-left transition-colors duration-300 hover:bg-surface focus-visible:bg-surface aria-[current=true]:bg-surface"
                    >
                      <MiniSeal org={org} className="w-10" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-body-lg font-semibold text-ink">
                          {org.acronym}
                        </span>
                        <span className="block truncate text-small text-ink-muted">{org.name}</span>
                      </span>
                      {current ? <Check aria-hidden="true" className="size-5 text-ink" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
