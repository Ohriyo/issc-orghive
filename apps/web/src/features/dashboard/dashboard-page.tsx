import { useCompliance } from '@/features/appeals/presenters/use-compliance';
import { RequireAuth } from '@/features/auth/auth-pages';
import { useSemestralReports } from '@/features/reports/presenters/use-semestral-reports';
import { useProjectsOverview } from '@/features/projects/presenters/use-projects';
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
  const model = useDashboard();
  const selected = model.status === 'ready' ? model.selected : null;
  // Officers (who may upload) create projects; members see them.
  const projects = useProjectsOverview(
    selected && { slug: selected.org.slug },
    !!selected?.uploadHref,
  );
  const compliance = useCompliance(selected?.org.slug ?? null);
  // The Semestral End Report is for officers (spec section 4).
  const reports = useSemestralReports(selected?.uploadHref ? selected.org.slug : null);
  return (
    <DashboardView model={model} projects={projects} compliance={compliance} reports={reports} />
  );
}
