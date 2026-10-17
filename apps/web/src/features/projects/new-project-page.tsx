import { RequireAuth } from '@/features/auth/auth-pages';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useNewProject } from './presenters/use-new-project';
import { NewProjectView } from './views/new-project-view';

/** /dashboard/projects/new?org= */
export function NewProjectPage() {
  return (
    <RequireAuth>
      <NewProjectContent />
    </RequireAuth>
  );
}

function NewProjectContent() {
  const model = useNewProject();
  usePageChrome(chrome.newProject(model.status === 'ready' ? model.org : null));
  return <NewProjectView model={model} />;
}
