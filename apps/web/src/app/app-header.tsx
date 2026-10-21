import { useState } from 'react';
import { KeyRound, LayoutDashboard, LogIn, LogOut, Menu, Search, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { Link } from 'react-router';
import { Container } from '@/components/container';
import { OrghiveLogo } from '@/components/orghive-logo';
import { PillButton } from '@/components/pill-button';
import type { AccountMenuModel } from '@/features/auth/presenters/use-account-menu';
import { Avatar, UserMenu } from '@/features/auth/views/user-menu';
import type { NotificationsModel } from '@/features/notifications/presenters/use-notifications';
import { NotificationBell } from '@/features/notifications/views/notification-bell';
import type { DocumentSearchModel } from '@/features/search/presenters/use-document-search';
import { SearchOverlay } from '@/features/search/views/search-overlay';
import { cn } from '@/lib/utils';
import type { NavSection } from '@/navigation/page-chrome';

export interface AppHeaderProps {
  search: DocumentSearchModel;
  account: AccountMenuModel;
  /** The bell, when signed in. Optional so tests and previews can leave it out. */
  notifications?: NotificationsModel;
  /** The section to highlight. */
  section: NavSection | null;
  /**
   * Over the home hero: transparent until scrolled, and the full links wait for 2xl so
   * they never reach the honeycomb in the top right (design/home.png).
   */
  overlay: boolean;
  /** Show the header's own background (always, except over the hero before scrolling). */
  solid: boolean;
}

interface NavItem {
  to: string;
  label: string;
  section: NavSection;
}

/** The hierarchy is the navigation (PRODUCT.md): the colleges, the ISSC, then your work. */
function navItems(signedIn: boolean): NavItem[] {
  const items: NavItem[] = [
    { to: '/colleges', label: 'Colleges', section: 'colleges' },
    { to: '/leaderboard', label: 'Leaderboard', section: 'leaderboard' },
    { to: '/handbook', label: 'Handbook', section: 'handbook' },
    { to: '/orgs/issc', label: 'ISSC', section: 'issc' },
  ];
  if (signedIn) items.push({ to: '/dashboard', label: 'Dashboard', section: 'dashboard' });
  return items;
}

const NAV_LINK =
  // min-w-9: with tap-area's 6px sides, a short label like "ISSC" still clears 44px.
  'tap-area min-w-9 text-center text-body font-medium text-ink underline decoration-transparent decoration-2 underline-offset-8 transition-colors duration-300 hover:decoration-leaf focus-visible:decoration-leaf aria-[current=true]:font-semibold aria-[current=true]:decoration-ink';

const ICON_BUTTON =
  'bg-forest-band grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-white shadow-pool';

/**
 * The one header on every page (rendered by AppShell): logo home, Colleges, Leaderboard,
 * Handbook, ISSC, Dashboard when signed in, Search, and the user menu or Login. Below the full-width
 * breakpoint the links move into a menu dialog. Sticky, but in the page flow, so it never
 * covers content or carousel arrows.
 */
export function AppHeader({
  search,
  account,
  notifications = { status: 'off' },
  section,
  overlay,
  solid,
}: AppHeaderProps) {
  const signedIn = account.status === 'authenticated';
  const items = navItems(signedIn);
  // Full links from xl; over the hero from 2xl. Static class names for Tailwind.
  const full = overlay ? 'hidden 2xl:flex' : 'hidden xl:flex';
  const fullInline = overlay ? 'hidden 2xl:inline-flex' : 'hidden xl:inline-flex';
  const compact = overlay ? '2xl:hidden' : 'xl:hidden';

  return (
    <header
      className={cn(
        'sticky top-0 z-40 h-(--header-h) transition-[background-color,box-shadow] duration-300 motion-reduce:transition-none',
        solid ? 'bg-surface shadow-[0_1px_0_var(--color-border)]' : 'bg-transparent',
        overlay && '-mb-(--header-h)',
      )}
    >
      <Container className="flex h-full items-center gap-3">
        <Link
          to="/"
          aria-label="Orghive home"
          className="-ml-1 inline-flex min-h-11 items-center rounded-full px-1"
        >
          <OrghiveLogo />
        </Link>

        <nav aria-label="Main" className={cn('ml-6 items-center gap-6', full)}>
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              aria-current={section === item.section ? 'true' : undefined}
              className={NAV_LINK}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div
          className={cn(
            'flex items-center gap-3',
            overlay ? 'ml-auto lg:ml-6 2xl:ml-6' : 'ml-auto',
          )}
        >
          <PillButton
            size="md"
            className={fullInline}
            aria-keyshortcuts="Control+K Meta+K"
            onClick={() => search.setOpen(true)}
          >
            <Search aria-hidden="true" />
            Search
          </PillButton>
          <button
            type="button"
            aria-label="Search"
            aria-keyshortcuts="Control+K Meta+K"
            className={cn(ICON_BUTTON, compact)}
            onClick={() => search.setOpen(true)}
          >
            <Search aria-hidden="true" className="size-5" />
          </button>
          <NotificationBell model={notifications} />
          {account.status === 'authenticated' ? (
            <UserMenu account={account} className={fullInline} />
          ) : (
            <PillButton asChild variant="light" size="md" className={fullInline}>
              <Link to="/login">
                <LogIn aria-hidden="true" />
                Login
              </Link>
            </PillButton>
          )}
          <MenuDialog items={items} section={section} account={account} className={compact} />
        </div>
      </Container>

      <SearchOverlay search={search} />
    </header>
  );
}

const MENU_LINK =
  'flex min-h-16 items-center text-h2 font-semibold text-ink transition-colors duration-300 hover:text-forest-700 focus-visible:text-forest-700 aria-[current=true]:underline aria-[current=true]:decoration-2 aria-[current=true]:underline-offset-8';
const ACCOUNT_ITEM =
  'flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-body-lg font-medium text-ink transition-colors duration-300 hover:bg-white focus-visible:bg-white disabled:opacity-50';

interface MenuDialogProps {
  items: NavItem[];
  section: NavSection | null;
  account: AccountMenuModel;
  className?: string;
}

/** Compact header: the links and the account in a full-screen dialog (focus trapped, Esc closes). */
function MenuDialog({ items, section, account, className }: MenuDialogProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger aria-label="Open menu" className={cn(ICON_BUTTON, className)}>
        <Menu aria-hidden="true" className="size-5" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          className="bg-surface-sweep fixed inset-0 z-50 flex flex-col overflow-y-auto overscroll-contain pt-[env(safe-area-inset-top,0px)] pb-safe duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none"
        >
          <Container className="flex h-(--header-h) shrink-0 items-center justify-between">
            <Dialog.Title className="text-h3 font-bold text-ink">Menu</Dialog.Title>
            <Dialog.Close
              aria-label="Close menu"
              className="grid size-11 cursor-pointer place-items-center rounded-full text-ink transition-colors duration-300 hover:bg-white focus-visible:bg-white"
            >
              <X aria-hidden="true" className="size-6" />
            </Dialog.Close>
          </Container>
          <Container as="nav" aria-label="Site" className="pt-6">
            <ul className="divide-y divide-border border-y border-border">
              <li>
                <Link
                  to="/"
                  onClick={close}
                  aria-current={section === 'home' ? 'true' : undefined}
                  className={MENU_LINK}
                >
                  Home
                </Link>
              </li>
              {items.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    onClick={close}
                    aria-current={section === item.section ? 'true' : undefined}
                    className={MENU_LINK}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </Container>
          {account.status === 'authenticated' ? (
            <Container as="section" aria-label="Your account" className="pt-8 pb-10">
              <div className="flex items-center gap-3">
                <Avatar initials={account.initials} className="size-11" />
                <div className="min-w-0">
                  <p className="truncate text-body-lg font-semibold text-ink">{account.name}</p>
                  <p className="truncate text-small text-ink-muted">{account.email}</p>
                </div>
              </div>
              {account.roles.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-0.5 text-small font-medium text-ink">
                  {account.roles.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
              <ul className="mt-4 flex flex-col gap-1">
                <li>
                  <Link to="/dashboard" onClick={close} className={ACCOUNT_ITEM}>
                    <LayoutDashboard aria-hidden="true" className="size-5" />
                    Dashboard
                  </Link>
                </li>
                <li>
                  <Link to="/change-password" onClick={close} className={ACCOUNT_ITEM}>
                    <KeyRound aria-hidden="true" className="size-5" />
                    Change password
                  </Link>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={account.signOut}
                    disabled={account.isSigningOut}
                    className={ACCOUNT_ITEM}
                  >
                    <LogOut aria-hidden="true" className="size-5" />
                    {account.isSigningOut ? 'Signing out…' : 'Sign out'}
                  </button>
                </li>
              </ul>
            </Container>
          ) : (
            <Container className="pt-8 pb-10">
              <PillButton asChild size="lg" className="w-full sm:w-auto">
                <Link to="/login" onClick={close}>
                  <LogIn aria-hidden="true" />
                  Login
                </Link>
              </PillButton>
            </Container>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
