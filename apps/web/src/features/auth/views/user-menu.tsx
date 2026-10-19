import { ChevronDown, KeyRound, LayoutDashboard, LogOut, ShieldCheck } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import type { AccountMenuModel } from '../presenters/use-account-menu';

type SignedIn = Extract<AccountMenuModel, { status: 'authenticated' }>;

const ITEM =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-body font-medium text-ink outline-none select-none data-[highlighted]:bg-surface data-[disabled]:opacity-50';

/** The avatar: initials on ink. Decorative; the name always sits beside it or in the label. */
export function Avatar({ initials, className }: { initials: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-full bg-ink text-small font-semibold text-white',
        className,
      )}
    >
      {initials}
    </span>
  );
}

/**
 * The signed-in user's menu in the header: avatar and name, opening Dashboard, Change
 * password and Sign out. Radix gives it menu semantics, arrow keys, Esc and focus return.
 */
export function UserMenu({ account, className }: { account: SignedIn; className?: string }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        aria-label={`Account menu, ${account.name}`}
        className={cn(
          'group inline-flex min-h-11 max-w-64 cursor-pointer items-center gap-2 rounded-full bg-white/80 py-1 pr-3 pl-1 text-body font-medium text-ink shadow-pool ring-1 ring-ink/10 transition-colors duration-300 hover:bg-white focus-visible:bg-white data-[state=open]:bg-white',
          className,
        )}
      >
        <Avatar initials={account.initials} />
        <span className="truncate">{account.name}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform duration-300 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className="z-50 w-72 max-w-[calc(100vw-2rem)] rounded-2xl bg-white p-2 shadow-pool-lift ring-1 ring-ink/10 duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none"
        >
          <DropdownMenu.Label className="px-3 pt-2 pb-3">
            <span className="block truncate text-body font-semibold text-ink">{account.name}</span>
            <span className="block truncate text-small text-ink-muted">{account.email}</span>
            {account.systemConsole ? (
              <span className="mt-2 block text-small font-medium text-ink">Super admin</span>
            ) : null}
            {account.roles.length > 0 ? (
              <span className="mt-2 flex flex-col gap-0.5">
                {account.roles.map((line) => (
                  <span key={line} className="text-small font-medium text-ink">
                    {line}
                  </span>
                ))}
              </span>
            ) : account.systemConsole ? null : (
              <span className="mt-2 block text-small text-ink-muted">No organization</span>
            )}
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="mx-3 mb-1 h-px bg-border" />
          {account.systemConsole ? (
            <DropdownMenu.Item asChild className={ITEM}>
              <Link to="/system">
                <ShieldCheck aria-hidden="true" className="size-5" />
                System console
              </Link>
            </DropdownMenu.Item>
          ) : null}
          <DropdownMenu.Item asChild className={ITEM}>
            <Link to="/dashboard">
              <LayoutDashboard aria-hidden="true" className="size-5" />
              Dashboard
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className={ITEM}>
            <Link to="/change-password">
              <KeyRound aria-hidden="true" className="size-5" />
              Change password
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="mx-3 my-1 h-px bg-border" />
          <DropdownMenu.Item
            className={ITEM}
            disabled={account.isSigningOut}
            onSelect={account.signOut}
          >
            <LogOut aria-hidden="true" className="size-5" />
            {account.isSigningOut ? 'Signing out…' : 'Sign out'}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
