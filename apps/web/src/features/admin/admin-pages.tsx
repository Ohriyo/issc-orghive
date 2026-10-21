import { Navigate } from 'react-router';
import { RequireAuth } from '@/features/auth/auth-pages';
import { AuthSkeleton } from '@/features/auth/views/auth-skeleton';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useAdminAccess } from './presenters/use-admin-access';
import { useAdminFigures } from './presenters/use-admin-figures';
import { useAdminOrganizations } from './presenters/use-admin-organizations';
import { AdminForbidden, AdminLayout } from './views/admin-layout';
import { useHandbookAdmin } from '@/features/handbook/presenters/use-handbook-admin';
import { HandbookAdminView } from '@/features/handbook/views/handbook-admin-view';
import { FiguresView } from './views/figures-view';
import { OrganizationsView } from './views/organizations-view';

/** Signed in, then ISSC admins only; everyone else sees why they cannot enter. */
function AdminGate({ children }: { children: React.ReactNode }) {
  const access = useAdminAccess();
  if (access === 'checking') return <AuthSkeleton />;
  if (access === 'forbidden') return <AdminForbidden />;
  return children;
}

/** /admin: opens on Organizations, the first section. */
export function AdminIndexPage() {
  return <Navigate to="/admin/organizations" replace />;
}

function Organizations() {
  usePageChrome(chrome.admin('Organizations'));
  const state = useAdminOrganizations();
  return (
    <AdminLayout title="Organizations">
      <OrganizationsView state={state} />
    </AdminLayout>
  );
}

export function AdminOrganizationsPage() {
  return (
    <RequireAuth>
      <AdminGate>
        <Organizations />
      </AdminGate>
    </RequireAuth>
  );
}

function FinancialFigures() {
  usePageChrome(chrome.admin('Financial figures'));
  const model = useAdminFigures();
  return (
    <AdminLayout title="Financial figures">
      <FiguresView model={model} />
    </AdminLayout>
  );
}

/** /admin/financial-figures: the ISSC's review of reported totals (spec 5D). */
export function AdminFinancialFiguresPage() {
  return (
    <RequireAuth>
      <AdminGate>
        <FinancialFigures />
      </AdminGate>
    </RequireAuth>
  );
}

function Handbook() {
  usePageChrome(chrome.admin('Student Handbook'));
  const model = useHandbookAdmin();
  return (
    <AdminLayout title="Student Handbook">
      <HandbookAdminView model={model} />
    </AdminLayout>
  );
}

/** /admin/handbook: the ISSC uploads the Student Handbook and chooses the current edition. */
export function AdminHandbookPage() {
  return (
    <RequireAuth>
      <AdminGate>
        <Handbook />
      </AdminGate>
    </RequireAuth>
  );
}
