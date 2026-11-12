import {
  CalendarClock,
  ChartLine,
  FlaskConical,
  Gauge,
  HeartPulse,
  Inbox,
  KeyRound,
  ScrollText,
  SlidersHorizontal,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router';
import { Container } from '@/components/container';
import { cn } from '@/lib/utils';

interface Section {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** The /system sections, grouped, in sidebar order. */
const GROUPS: readonly { label: string; sections: readonly Section[] }[] = [
  {
    label: 'Monitor',
    sections: [
      { to: '/system/overview', label: 'Overview', icon: Gauge },
      { to: '/system/health', label: 'Health', icon: HeartPulse },
      { to: '/system/metrics', label: 'Metrics', icon: ChartLine },
    ],
  },
  {
    label: 'Accounts',
    sections: [
      { to: '/system/users', label: 'Users', icon: Users },
      { to: '/system/account-requests', label: 'Account requests', icon: Inbox },
      { to: '/system/super-admins', label: 'Super admins', icon: ShieldCheck },
      { to: '/system/end-of-term', label: 'End of term', icon: CalendarClock },
    ],
  },
  {
    label: 'System',
    sections: [
      { to: '/system/settings', label: 'Settings', icon: SlidersHorizontal },
      { to: '/system/test-data', label: 'Test data', icon: FlaskConical },
      { to: '/system/audit', label: 'Audit log', icon: ScrollText },
      { to: '/system/security', label: 'My security', icon: KeyRound },
    ],
  },
];

const NAV_LINK = cn(
  'relative flex min-h-11 shrink-0 items-center gap-2.5 rounded-lg px-3 text-body font-medium whitespace-nowrap text-ink-muted',
  'transition-colors duration-300 hover:bg-white/70 hover:text-ink focus-visible:bg-white/70 focus-visible:text-ink',
  'aria-[current=page]:bg-white aria-[current=page]:text-ink aria-[current=page]:ring-1 aria-[current=page]:ring-border',
);

/**
 * Below lg the sections are one row that scrolls sideways: keep the current one in view
 * (moving only the row, never the page) so a phone always shows where you are.
 */
function useCurrentInView(row: React.RefObject<HTMLUListElement | null>, pathname: string) {
  useEffect(() => {
    const list = row.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !current || list.scrollWidth <= list.clientWidth) return;
    const left = current.offsetLeft - (list.clientWidth - current.offsetWidth) / 2;
    list.scrollTo({ left: Math.max(0, left) });
  }, [row, pathname]);
}

export interface SystemLayoutProps {
  title: string;
  /** One line under the title. */
  description?: string;
  /** Right of the title, e.g. a Refresh button. */
  actions?: React.ReactNode;
  /** Open account requests: a badge on that section. */
  requestCount?: number;
  /** Above the title on every console page, e.g. open system alerts. */
  banner?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * /system: the super admin console. Calm and dense: a sidebar of grouped sections from lg up
 * (one row that scrolls sideways below lg), and the full remaining width for tables.
 *
 * The whole sidebar (heading, groups and the session note) sticks below the header as one
 * block and scrolls on its own when the window is short, so nothing slides over anything.
 */
export function SystemLayout({
  title,
  description,
  actions,
  requestCount = 0,
  banner,
  children,
}: SystemLayoutProps) {
  const row = useRef<HTMLUListElement>(null);
  useCurrentInView(row, useLocation().pathname);

  return (
    <div className="min-h-page bg-surface">
      <title>{`${title} | System | Orghive`}</title>
      <meta name="robots" content="noindex" />
      <Container className="pt-2 pb-section lg:pt-6">
        <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-10">
          <nav
            aria-label="System console"
            className="relative mb-6 lg:sticky lg:top-[calc(var(--header-h)+1.5rem)] lg:mb-0 lg:max-h-[calc(100dvh-var(--header-h)-3rem)] lg:overflow-y-auto lg:overscroll-contain"
          >
            <p className="mb-2 hidden px-3 text-caption font-semibold tracking-wide text-ink-muted uppercase lg:block">
              System console
            </p>
            <ul
              ref={row}
              className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [mask-image:linear-gradient(to_right,transparent,black_1rem,black_calc(100%-1.5rem),transparent)] lg:flex-col lg:gap-5 lg:overflow-visible lg:[mask-image:none]"
            >
              {GROUPS.map((group) => (
                <li key={group.label} className="contents lg:block">
                  <p className="hidden px-3 pb-1 text-caption font-medium text-ink-muted lg:block">
                    {group.label}
                  </p>
                  <ul className="contents lg:flex lg:flex-col lg:gap-1" aria-label={group.label}>
                    {group.sections.map(({ to, label, icon: Icon }) => (
                      <li key={to} className="shrink-0">
                        <NavLink to={to} className={NAV_LINK}>
                          <Icon aria-hidden="true" className="size-4.5 shrink-0" />
                          {label}
                          {to === '/system/account-requests' && requestCount > 0 ? (
                            <span className="ml-auto rounded-full bg-destructive px-2 py-0.5 text-caption font-semibold text-white tabular-nums">
                              {requestCount}
                              <span className="sr-only"> open</span>
                            </span>
                          ) : null}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            <p className="mt-6 hidden px-3 text-small text-ink-muted lg:block">
              Sessions end after 15 idle minutes or 8 hours. Every action here is audited.
            </p>
          </nav>

          <main className="min-w-0">
            {banner}
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
