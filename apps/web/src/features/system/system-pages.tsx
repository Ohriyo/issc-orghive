import { useParams } from 'react-router';
import { SectionError } from '@/components/section-error';
import { RequireAuth } from '@/features/auth/auth-pages';
import { AuthSkeleton } from '@/features/auth/views/auth-skeleton';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useSystemAccess } from './presenters/use-system-access';
import { useCreateAccount } from './presenters/use-create-account';
import { useSystemAccount } from './presenters/use-system-account';
import { useSystemAudit } from './presenters/use-system-audit';
import { useSystemOverview } from './presenters/use-system-overview';
import { useSystemSecurity } from './presenters/use-system-security';
import { useSystemUsers } from './presenters/use-system-users';
import { useTestData } from './presenters/use-test-data';
import { AccountView } from './views/account-view';
import { AuditView } from './views/audit-view';
import { CreateAccountView } from './views/create-account-view';
import { OverviewView, RefreshButton } from './views/overview-view';
import { SecurityView } from './views/security-view';
import { SystemForbidden, SystemLayout, SystemLoading } from './views/system-layout';
import { TestDataView } from './views/test-data-view';
import { CreateAccountButton, UsersView } from './views/users-view';

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
      description="One shared account per organization. Open one to manage it."
      actions={<CreateAccountButton />}
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

function NewAccount() {
  usePageChrome(chrome.systemAccount('Create account'));
  const model = useCreateAccount();
  return (
    <SystemLayout
      title="Create account"
      description="The shared account of one organization: an existing one, or a new CSC or SBO."
    >
      <CreateAccountView model={model} />
    </SystemLayout>
  );
}

function Account() {
  const { userId = '' } = useParams();
  const model = useSystemAccount(userId);
  const title = model.status === 'ready' ? model.summary.name : 'Account';
  usePageChrome(chrome.systemAccount(title));
  return (
    <SystemLayout
      title={title}
      description={model.status === 'ready' ? model.summary.email : undefined}
    >
      {model.status === 'loading' ? (
        <SystemLoading label="Loading the account" />
      ) : model.status === 'not-found' ? (
        <p className="rounded-xl bg-white px-5 py-6 text-body text-ink ring-1 ring-border">
          This account does not exist. It may have been removed, or the link is wrong.
        </p>
      ) : model.status === 'error' ? (
        <SectionError message="The account could not be loaded." onRetry={model.retry} />
      ) : (
        <AccountView model={model} />
      )}
    </SystemLayout>
  );
}

function TestData() {
  usePageChrome(chrome.system('Test data'));
  const model = useTestData();
  return (
    <SystemLayout
      title="Test data"
      description="Review, then delete the files flagged as test data."
    >
      <TestDataView model={model} />
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

export function SystemNewAccountPage() {
  return (
    <Gated>
      <NewAccount />
    </Gated>
  );
}

export function SystemAccountPage() {
  return (
    <Gated>
      <Account />
    </Gated>
  );
}

export function SystemTestDataPage() {
  return (
    <Gated>
      <TestData />
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
