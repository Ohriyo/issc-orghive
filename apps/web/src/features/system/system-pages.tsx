import { useParams } from 'react-router';
import { SectionError } from '@/components/section-error';
import { RequireAuth } from '@/features/auth/auth-pages';
import { AuthSkeleton } from '@/features/auth/views/auth-skeleton';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useSystemAccess } from './presenters/use-system-access';
import { useAccountRequests, useOpenRequestCount } from './presenters/use-account-requests';
import { useCreateAccount } from './presenters/use-create-account';
import { useCsvImport } from './presenters/use-csv-import';
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
import {
  SystemForbidden,
  SystemLayout,
  SystemLoading,
  type SystemLayoutProps,
} from './views/system-layout';
import { AccountRequestsView } from './views/account-requests-view';
import { ImportView } from './views/import-view';
import { TestDataView } from './views/test-data-view';
import { BulkCreateButton, CreateAccountButton, UsersView } from './views/users-view';

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

/** The console's layout, with the open account requests' badge. */
function Console(props: Omit<SystemLayoutProps, 'requestCount'>) {
  const requestCount = useOpenRequestCount();
  return <SystemLayout {...props} requestCount={requestCount} />;
}

function BulkAccounts() {
  usePageChrome(chrome.systemAccount('Bulk create'));
  const model = useCsvImport('bulk');
  return (
    <Console
      title="Bulk create accounts"
      description="Accounts for many existing organizations at once, from a CSV file."
    >
      <ImportView model={model} />
    </Console>
  );
}

function EndOfTerm() {
  usePageChrome(chrome.system('End of term'));
  const model = useCsvImport('end-of-term');
  return (
    <Console
      title="End of term"
      description="Hand every organization account to its incoming officers. Accounts not in the file are locked until assigned."
    >
      <ImportView model={model} />
    </Console>
  );
}

function AccountRequests() {
  usePageChrome(chrome.system('Account requests'));
  const model = useAccountRequests();
  return (
    <Console
      title="Account requests"
      description="What the ISSC asked for. Creating one sends its temporary password to the ISSC's one-time Reveal."
    >
      <AccountRequestsView model={model} />
    </Console>
  );
}

function Overview() {
  usePageChrome(chrome.system(null));
  const state = useSystemOverview();
  return (
    <Console
      title="Overview"
      description="Accounts, documents and background work across Orghive."
      actions={<RefreshButton state={state} />}
    >
      <OverviewView state={state} />
    </Console>
  );
}

function Users() {
  usePageChrome(chrome.system('Users'));
  const model = useSystemUsers({ superAdminsOnly: false });
  return (
    <Console
      title="Users"
      description="One shared account per organization. Open one to manage it."
      actions={
        <div className="flex flex-wrap gap-3">
          <BulkCreateButton />
          <CreateAccountButton />
        </div>
      }
    >
      <UsersView model={model} superAdmins={false} />
    </Console>
  );
}

function SuperAdmins() {
  usePageChrome(chrome.system('Super admins'));
  const model = useSystemUsers({ superAdminsOnly: true });
  return (
    <Console
      title="Super admins"
      description="Added only with the create-super-admin command. At least one must stay active."
    >
      <UsersView model={model} superAdmins />
    </Console>
  );
}

function NewAccount() {
  usePageChrome(chrome.systemAccount('Create account'));
  const model = useCreateAccount();
  return (
    <Console
      title="Create account"
      description="The shared account of one organization: an existing one, or a new CSC or SBO."
    >
      <CreateAccountView model={model} />
    </Console>
  );
}

function Account() {
  const { userId = '' } = useParams();
  const model = useSystemAccount(userId);
  const title = model.status === 'ready' ? model.summary.name : 'Account';
  usePageChrome(chrome.systemAccount(title));
  return (
    <Console title={title} description={model.status === 'ready' ? model.summary.email : undefined}>
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
    </Console>
  );
}

function TestData() {
  usePageChrome(chrome.system('Test data'));
  const model = useTestData();
  return (
    <Console title="Test data" description="Review, then delete the files flagged as test data.">
      <TestDataView model={model} />
    </Console>
  );
}

function Audit() {
  usePageChrome(chrome.system('Audit log'));
  const model = useSystemAudit();
  return (
    <Console title="Audit log" description="Newest first. Times are Manila time.">
      <AuditView model={model} />
    </Console>
  );
}

function Security() {
  usePageChrome(chrome.system('My security'));
  const model = useSystemSecurity();
  return (
    <Console title="My security" description="This session and your two-step sign-in.">
      <SecurityView model={model} />
    </Console>
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

export function SystemBulkAccountsPage() {
  return (
    <Gated>
      <BulkAccounts />
    </Gated>
  );
}

export function SystemEndOfTermPage() {
  return (
    <Gated>
      <EndOfTerm />
    </Gated>
  );
}

export function SystemAccountRequestsPage() {
  return (
    <Gated>
      <AccountRequests />
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
