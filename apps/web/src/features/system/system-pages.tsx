import { RequireAuth } from '@/features/auth/auth-pages';
import { AuthSkeleton } from '@/features/auth/views/auth-skeleton';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useSystemAccess } from './presenters/use-system-access';
import { useSystemAudit } from './presenters/use-system-audit';
import { useSystemOverview } from './presenters/use-system-overview';
import { useSystemSecurity } from './presenters/use-system-security';
import { useSystemUsers } from './presenters/use-system-users';
import { AuditView } from './views/audit-view';
import { OverviewView, RefreshButton } from './views/overview-view';
import { SecurityView } from './views/security-view';
import { SystemForbidden, SystemLayout } from './views/system-layout';
import { UsersView } from './views/users-view';

/** Signed in (with MFA confirmed), then super admins only; everyone else sees why not. */
function SystemGate({ children }: { children: React.ReactNode }) {
  const access = useSystemAccess();
  if (access === 'checking') return <AuthSkeleton />;
  if (access === 'forbidden') return <SystemForbidden />;
  return children;
}

function Gated({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <SystemGate>{children}</SystemGate>
    </RequireAuth>
  );
}

function Overview() {
  usePageChrome(chrome.system(null));
  const state = useSystemOverview();
  return (
    <SystemLayout
      title="Overview"
      description="Accounts, documents and background work across Orghive."
      actions={<RefreshButton state={state} />}
    >
      <OverviewView state={state} />
    </SystemLayout>
  );
}

function Users() {
  usePageChrome(chrome.system('Users'));
  const model = useSystemUsers({ superAdminsOnly: false });
  return (
    <SystemLayout
      title="Users"
      description="Every account. Deactivating one signs it out everywhere."
    >
      <UsersView model={model} superAdmins={false} />
    </SystemLayout>
  );
}

function SuperAdmins() {
  usePageChrome(chrome.system('Super admins'));
  const model = useSystemUsers({ superAdminsOnly: true });
  return (
    <SystemLayout
      title="Super admins"
      description="Added only with the create-super-admin command. At least one must stay active."
    >
      <UsersView model={model} superAdmins />
    </SystemLayout>
  );
}

function Audit() {
  usePageChrome(chrome.system('Audit log'));
  const model = useSystemAudit();
  return (
    <SystemLayout title="Audit log" description="Newest first. Times are Manila time.">
      <AuditView model={model} />
    </SystemLayout>
  );
}

function Security() {
  usePageChrome(chrome.system('My security'));
  const model = useSystemSecurity();
  return (
    <SystemLayout title="My security" description="This session and your two-step sign-in.">
      <SecurityView model={model} />
    </SystemLayout>
  );
}

export function SystemOverviewPage() {
  return (
    <Gated>
      <Overview />
    </Gated>
  );
}

export function SystemUsersPage() {
  return (
    <Gated>
      <Users />
    </Gated>
  );
}

export function SystemSuperAdminsPage() {
  return (
    <Gated>
      <SuperAdmins />
    </Gated>
  );
}

export function SystemAuditPage() {
  return (
    <Gated>
      <Audit />
    </Gated>
  );
}

export function SystemSecurityPage() {
  return (
    <Gated>
      <Security />
    </Gated>
  );
}
