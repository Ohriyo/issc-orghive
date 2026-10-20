import { NavLink } from 'react-router';
import { Container } from '@/components/container';
import { cn } from '@/lib/utils';

/** The /admin sections. New ones join this list as they are built. */
const ADMIN_SECTIONS = [
  { to: '/admin/organizations', label: 'Organizations' },
  { to: '/admin/financial-figures', label: 'Financial figures' },
] as const;

const NAV_LINK = cn(
  '-mb-px flex min-h-11 shrink-0 items-center border-b-2 border-transparent px-1 text-body font-medium text-ink-muted',
  'transition-colors duration-300 hover:text-ink focus-visible:text-ink',
  'aria-[current=page]:border-ink aria-[current=page]:text-ink',
);

/**
 * /admin: a quiet workspace. The sections are tabs above the page, which keeps the full
 * width for its tables; the row scrolls sideways if the sections outgrow a phone.
 */
export function AdminLayout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-page bg-surface">
      <title>{`${title} | Admin | Orghive`}</title>
      <Container className="pt-2 pb-section lg:pt-4">
        <nav aria-label="Admin" className="mb-6 border-b border-border">
          <ul className="flex gap-6 overflow-x-auto">
            {ADMIN_SECTIONS.map((section) => (
              <li key={section.to}>
                <NavLink to={section.to} className={NAV_LINK}>
                  {section.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0">{children}</main>
      </Container>
    </div>
  );
}

/** For any signed-in account other than the ISSC's. */
export function AdminForbidden() {
  return (
    <div className="min-h-page bg-surface">
      <title>Admin | Orghive</title>
      <Container as="main" className="pt-4 pb-section lg:pt-6">
        <h1 className="text-h2 font-bold text-ink">Admins only</h1>
        <p className="mt-3 max-w-prose text-body-lg text-ink">
          These tools are for the ISSC account. Sign in with it to manage colleges and
          organizations.
        </p>
      </Container>
    </div>
  );
}
