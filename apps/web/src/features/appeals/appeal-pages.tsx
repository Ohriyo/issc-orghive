import { RequireAuth } from '@/features/auth/auth-pages';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useAppealQueue } from './presenters/use-appeal-queue';
import { useSubmitAppeal } from './presenters/use-submit-appeal';
import { AppealQueueView } from './views/appeal-queue-view';
import { SubmitAppealView } from './views/submit-appeal-view';

/** /dashboard/appeals: appeals waiting for the user's decision. */
export function AppealQueuePage() {
  return (
    <RequireAuth>
      <AppealQueueContent />
    </RequireAuth>
  );
}

function AppealQueueContent() {
  usePageChrome(chrome.appeals());
  return <AppealQueueView model={useAppealQueue()} />;
}

/** /dashboard/appeals/new?org=&project= | &freeze= */
export function SubmitAppealPage() {
  return (
    <RequireAuth>
      <SubmitAppealContent />
    </RequireAuth>
  );
}

function SubmitAppealContent() {
  const model = useSubmitAppeal();
  const target = model.status === 'ready' ? model.target : null;
  usePageChrome(
    chrome.submitAppeal(
      target?.kind === 'blocked' ? { id: target.projectId, name: target.projectName } : null,
    ),
  );
  return <SubmitAppealView model={model} />;
}
