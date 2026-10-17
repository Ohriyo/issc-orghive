import { useParams } from 'react-router';
import { NotFoundPanel } from '@/components/not-found-panel';
import { openAppealAttachment } from '@/features/appeals/presenters/use-appeal-queue';
import { useCompliance, useProjectAppeals } from '@/features/appeals/presenters/use-compliance';
import { AppealHistory } from '@/features/appeals/views/appeal-history';
import { ComplianceBanner } from '@/features/appeals/views/compliance-banner';
import { RequireAuth } from '@/features/auth/auth-pages';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useProject } from './presenters/use-project';
import { ProjectView } from './views/project-view';

/** /projects/:id: a project's checklist, its block or freeze, and its appeals. */
export function ProjectPage() {
  return (
    <RequireAuth>
      <ProjectContent />
    </RequireAuth>
  );
}

function ProjectContent() {
  const { id = '' } = useParams();
  const state = useProject(id);
  const project = state.status === 'ready' ? state.project : null;
  const compliance = useCompliance(project?.org.slug ?? null);
  const appeals = useProjectAppeals(id);
  usePageChrome(chrome.project(project?.org ?? null, project?.name ?? null));

  if (state.status === 'not-found') {
    return (
      <NotFoundPanel
        title="Project not found"
        message="This project does not exist, or it belongs to an organization you are not in."
        action={{ label: 'Go to the dashboard', to: '/dashboard' }}
      />
    );
  }
  return (
    <ProjectView
      {...state}
      compliance={<ComplianceBanner model={compliance} projectId={id} />}
      appeals={
        <AppealHistory
          model={appeals}
          onOpenAttachment={(appealId, attachmentId) =>
            void openAppealAttachment(appealId, attachmentId)
          }
        />
      }
    />
  );
}
