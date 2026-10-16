import { useState } from 'react';
import { Menu, Search, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { NavLink } from 'react-router';
import { Container } from '@/components/container';
import { PillButton } from '@/components/pill-button';
import { cn } from '@/lib/utils';
import type { AccountLink } from '@/features/auth/presenters/use-auth';
import type { DocumentSearchModel } from '@/features/search/presenters/use-document-search';
import { SearchOverlay } from '@/features/search/views/search-overlay';

export interface SiteHeaderProps {
  search: DocumentSearchModel;
  account: AccountLink;
}

/** The hierarchy is the navigation (PRODUCT.md): the university, its colleges, the ISSC. */
const NAV_LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/colleges', label: 'Colleges', end: false },
  { to: '/orgs/issc', label: 'ISSC', end: false },
] as const;

const TEXT_LINK =
  'tap-area text-body font-medium text-ink underline decoration-1 underline-offset-4 transition-colors duration-300 hover:decoration-leaf focus-visible:decoration-leaf aria-[current=page]:decoration-2';

const ICON_BUTTON =
  'bg-forest-band grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-white shadow-pool';

/**
 * Floats over the hero, top left, as in the prototype. From xl: the Search pill and the
 * links in full. Below xl: a search icon and a menu button that opens the links in a
 * full-screen dialog. Full links wait for xl because the hero honeycomb bleeds into the
 * top right (design/home.png), leaving about 28rem beside it; below 1280px that space
 * cannot hold the pill and four links without covering hexagons.
 */
export function SiteHeader({ search, account }: SiteHeaderProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const links = [...NAV_LINKS, { to: account.href, label: account.label, end: true }];

  return (
    <header className="absolute inset-x-0 top-0 z-20">
      <Container as="nav" aria-label="Main" className="flex items-center gap-3 pt-6 sm:pt-10">
        <PillButton size="md" className="hidden xl:inline-flex" onClick={() => setSearchOpen(true)}>
          <Search aria-hidden="true" />
          Search
        </PillButton>
        <button
          type="button"
          aria-label="Search"
          className={cn(ICON_BUTTON, 'xl:hidden')}
          onClick={() => setSearchOpen(true)}
        >
          <Search aria-hidden="true" className="size-5" />
        </button>

        <ul className="ml-6 hidden items-center gap-6 xl:flex">
          {links.map((link) => (
            <li key={link.to}>
              <NavLink to={link.to} end={link.end} className={TEXT_LINK}>
                {link.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <MenuDialog links={links} />
      </Container>

      <SearchOverlay open={searchOpen} onOpenChange={setSearchOpen} search={search} />
    </header>
  );
}

interface MenuDialogProps {
  links: { to: string; label: string; end: boolean }[];
}

/** Below xl: the site links in a full-screen modal dialog (focus trapped, Esc closes). */
function MenuDialog({ links }: MenuDialogProps) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        aria-label="Open menu" // Right-aligned on phones and tablets; at lg the honeycomb fills the top right, so
        // the button sits beside the search icon instead.
        className={cn(ICON_BUTTON, 'ml-auto lg:ml-0 xl:hidden')}
      >
        <Menu aria-hidden="true" className="size-5" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          className="bg-surface-sweep fixed inset-0 z-50 flex flex-col overflow-y-auto overscroll-contain pt-[env(safe-area-inset-top,0px)] pb-safe duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none"
        >
          <Container className="flex items-center justify-between pt-6 sm:pt-10">
            <Dialog.Title className="text-h3 font-bold text-ink">Menu</Dialog.Title>
            <Dialog.Close
              aria-label="Close menu"
              className="grid size-11 cursor-pointer place-items-center rounded-full text-ink transition-colors duration-300 hover:bg-white focus-visible:bg-white"
            >
              <X aria-hidden="true" className="size-6" />
            </Dialog.Close>
          </Container>
          <Container as="nav" aria-label="Site" className="pt-8">
            <ul className="divide-y divide-border border-y border-border">
              {links.map((link) => (
                <li key={link.to}>
                  <NavLink
                    to={link.to}
                    end={link.end}
                    onClick={() => setOpen(false)}
                    className="flex min-h-16 items-center text-h2 font-semibold text-ink transition-colors duration-300 hover:text-forest-700 focus-visible:text-forest-700 aria-[current=page]:underline aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-8"
                  >
                    {link.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </Container>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
