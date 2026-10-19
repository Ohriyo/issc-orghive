import { FlaskConical, Gauge, KeyRound, ScrollText, ShieldCheck, Users } from 'lucide-react';
import { NavLink } from 'react-router';
import { Container } from '@/components/container';
import { cn } from '@/lib/utils';

/** The /system sections, in sidebar order. */
const SECTIONS = [
  { to: '/system/overview', label: 'Overview', icon: Gauge },
  { to: '/system/users', label: 'Users', icon: Users },
  { to: '/system/super-admins', label: 'Super admins', icon: ShieldCheck },
  { to: '/system/test-data', label: 'Test data', icon: FlaskConical },
  { to: '/system/audit', label: 'Audit log', icon: ScrollText },
  { to: '/system/security', label: 'My security', icon: KeyRound },
] as const;

const NAV_LINK = cn(
  'flex min-h-11 shrink-0 items-center gap-2.5 rounded-lg px-3 text-body font-medium whitespace-nowrap text-ink-muted',
  'transition-colors duration-300 hover:bg-white/70 hover:text-ink focus-visible:bg-white/70 focus-visible:text-ink',
  'aria-[current=page]:bg-white aria-[current=page]:text-ink aria-[current=page]:ring-1 aria-[current=page]:ring-border',
);

export interface SystemLayoutProps {
  title: string;
  /** One line under the title. */
  description?: string;
  /** Right of the title, e.g. a Refresh button. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * /system: the super admin console. Calm and dense: a sidebar of sections from lg up (a
 * row that scrolls sideways on phones), and the full remaining width for tables.
 */
export function SystemLayout({ title, description, actions, children }: SystemLayoutProps) {
  return (
    <div className="min-h-page bg-surface">
      <title>{`${title} | System | Orghive`}</title>
      <meta name="robots" content="noindex" />
      <Container className="pt-2 pb-section lg:pt-6">
        <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
          <nav aria-label="System console" className="mb-6 lg:mb-0">
            <p className="mb-2 hidden px-3 text-caption font-semibold tracking-wide text-ink-muted uppercase lg:block">
              System console
            </p>
            <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:sticky lg:top-24 lg:flex-col lg:overflow-visible">
              {SECTIONS.map(({ to, label, icon: Icon }) => (
                <li key={to}>
                  <NavLink to={to} className={NAV_LINK}>
                    <Icon aria-hidden="true" className="size-4.5 shrink-0" />
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
            <p className="mt-6 hidden px-3 text-small text-ink-muted lg:block">
              Sessions end after 15 idle minutes or 8 hours. Every action here is audited.
            </p>
          </nav>

          <main className="min-w-0">
            <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <div className="min-w-0">
                <h1 className="text-h2 font-bold text-ink">{title}</h1>
                {description ? (
                  <p className="mt-1 max-w-prose text-body text-ink-muted">{description}</p>
                ) : null}
              </div>
              {actions}
            </header>
            {children}
          </main>
        </div>
      </Container>
    </div>
  );
}

/** For signed-in users who are not super admins. */
export function SystemForbidden() {
  return (
    <div className="min-h-page bg-surface">
      <title>System | Orghive</title>
      <Container as="main" className="pt-4 pb-section lg:pt-6">
        <h1 className="text-h2 font-bold text-ink">Super admins only</h1>
        <p className="mt-3 max-w-prose text-body-lg text-ink">
          The system console is for Orghive&rsquo;s developers. Organization officers and ISSC
          admins manage their work from the Dashboard.
        </p>
      </Container>
    </div>
  );
}

/** A section's loading state: a few quiet bars. */
export function SystemLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only">{label}</span>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          aria-hidden="true"
          className="h-12 animate-pulse rounded-xl bg-surface-deep motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}
