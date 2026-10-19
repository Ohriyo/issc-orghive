import { RequireAuth } from '@/features/auth/auth-pages';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useNotificationCenter } from './presenters/use-notification-center';
import { useNotificationSettings } from './presenters/use-notification-settings';
import { NotificationCenterView } from './views/notification-center-view';
import { NotificationSettingsView } from './views/notification-settings-view';

/** /dashboard/notifications?show=unread */
export function NotificationsPage() {
  return (
    <RequireAuth>
      <NotificationsContent />
    </RequireAuth>
  );
}

function NotificationsContent() {
  usePageChrome(chrome.notifications());
  return <NotificationCenterView model={useNotificationCenter()} />;
}

/** /dashboard/notifications/settings */
export function NotificationSettingsPage() {
  return (
    <RequireAuth>
      <NotificationSettingsContent />
    </RequireAuth>
  );
}

function NotificationSettingsContent() {
  usePageChrome(chrome.notificationSettings());
  return <NotificationSettingsView model={useNotificationSettings()} />;
}
