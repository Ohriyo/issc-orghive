import { Navigate } from 'react-router';
import { RequireAuth } from '@/features/auth/auth-pages';
import { AuthSkeleton } from '@/features/auth/views/auth-skeleton';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useAdminAccess } from './presenters/use-admin-access';
import { useAdminOrganizations } from './presenters/use-admin-organizations';
import { AdminForbidden, AdminLayout } from './views/admin-layout';
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
