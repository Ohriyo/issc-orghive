import { Navigate } from 'react-router';
import { RequireAuth } from '@/features/auth/auth-pages';
import { AuthSkeleton } from '@/features/auth/views/auth-skeleton';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useAdminAccess } from './presenters/use-admin-access';
import { useAdminDisqualifications } from './presenters/use-admin-disqualifications';
import { useAdminFigures } from './presenters/use-admin-figures';
import { useAdminOrganizations } from './presenters/use-admin-organizations';
import { useAdminSemesters } from './presenters/use-admin-semesters';
import { AdminForbidden, AdminLayout } from './views/admin-layout';
import { useHandbookAdmin } from '@/features/handbook/presenters/use-handbook-admin';
import { HandbookAdminView } from '@/features/handbook/views/handbook-admin-view';
import { DisqualificationsView } from './views/disqualifications-view';
import { FiguresView } from './views/figures-view';
import { OrganizationsView } from './views/organizations-view';
import { SemestersView } from './views/semesters-view';

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

function Semesters() {
  usePageChrome(chrome.admin('Semesters'));
  const model = useAdminSemesters();
  return (
    <AdminLayout title="Semesters">
      <SemestersView model={model} />
    </AdminLayout>
  );
}

/** /admin/semesters: the ISSC sets each semester's first and last day (spec 5B). */
export function AdminSemestersPage() {
  return (
    <RequireAuth>
      <AdminGate>
        <Semesters />
      </AdminGate>
    </RequireAuth>
  );
}

function Disqualifications() {
  usePageChrome(chrome.admin('Disqualifications'));
  const model = useAdminDisqualifications();
  return (
    <AdminLayout title="Disqualifications">
      <DisqualificationsView model={model} />
    </AdminLayout>
  );
}

/** /admin/disqualifications: the ISSC's penalty on a semester's leaderboard (spec 5B). */
export function AdminDisqualificationsPage() {
  return (
    <RequireAuth>
      <AdminGate>
        <Disqualifications />
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
