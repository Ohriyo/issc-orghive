import { useParams } from 'react-router';
import { NotFoundPanel } from '@/components/not-found-panel';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useBackNavigation } from '@/navigation/use-back-navigation';
import { useUpdate } from './presenters/use-update';
import { useUpdates } from './presenters/use-updates';
import { UpdateView } from './views/update-view';
import { UpdatesView } from './views/updates-view';

/** /updates?org=: public, so no sign-in; officers of a council also see "Post an update". */
export function UpdatesPage() {
  usePageChrome(chrome.updates());
  return <UpdatesView model={useUpdates()} />;
}

/** /updates/:id */
export function UpdatePage() {
  const { id = '' } = useParams();
  const model = useUpdate(id);
  const pageChrome = chrome.update(model.status === 'ready' ? model.item.title : null);
  usePageChrome(pageChrome);
  const back = useBackNavigation(pageChrome.parent);

  if (model.status === 'not-found') {
    return (
      <NotFoundPanel
        title="Update not found"
        message="This update was removed or the link is wrong."
        action={{ label: 'All updates', to: '/updates' }}
      />
    );
  }
  return <UpdateView model={model} onDeleted={() => back.finish('Update deleted.')} />;
}
