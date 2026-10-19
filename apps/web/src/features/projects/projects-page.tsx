import { RequireAuth } from '@/features/auth/auth-pages';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useProjectsPage } from './presenters/use-projects';
import { ProjectsView } from './views/projects-view';

/** /dashboard/projects?org= */
export function ProjectsPage() {
  return (
    <RequireAuth>
      <ProjectsContent />
    </RequireAuth>
  );
}

function ProjectsContent() {
  const model = useProjectsPage();
  usePageChrome(chrome.projects(model.status === 'ready' ? model.org : null));
  return <ProjectsView model={model} />;
}
