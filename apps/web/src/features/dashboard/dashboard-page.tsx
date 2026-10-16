import { RequireAuth } from '@/features/auth/auth-pages';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useDashboard } from './presenters/use-dashboard';
import { DashboardView } from './views/dashboard-view';

/** /dashboard: where everyone lands after signing in. */
export function DashboardPage() {
  return (
    <RequireAuth>
      <DashboardContent />
    </RequireAuth>
  );
}

function DashboardContent() {
  usePageChrome(chrome.dashboard());
  return <DashboardView model={useDashboard()} />;
}
