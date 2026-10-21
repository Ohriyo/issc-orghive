import { useActingAs } from '@/features/auth/presenters/use-acting-as';
import { useConstitution } from '@/features/organizations/presenters/use-constitution';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useConstitutionUpload } from './presenters/use-constitution-upload';
import { useProfileEditor } from './presenters/use-profile-editor';
import { ProfileEditorView } from './views/profile-editor-view';

/** /dashboard/profile: the organization's own account edits its public profile. */
export function ProfilePage() {
  // One "Acting as" for the whole page: saving the profile and uploading the constitution.
  const actingAs = useActingAs();
  const model = useProfileEditor(actingAs);
  const ready = model.status === 'ready' ? model : null;
  const slug = ready?.org.slug ?? '';
  const constitution = useConstitutionUpload(slug, actingAs);
  const previewConstitution = useConstitution(slug);
  usePageChrome(chrome.workspace('Profile', ready?.org ?? null));

  return (
    <ProfileEditorView
      model={model}
      constitution={constitution}
      previewConstitution={previewConstitution}
    />
  );
}
