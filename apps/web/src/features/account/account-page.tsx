import { LogOut } from 'lucide-react';
import { Link } from 'react-router';
import { PillButton } from '@/components/pill-button';
import { RequireAuth } from '@/features/auth/auth-pages';
import { useAuth } from '@/features/auth/presenters/use-auth';
import { useSignOut } from '@/features/auth/presenters/use-auth-forms';
import { AuthLayout, TEXT_LINK } from '@/features/auth/views/auth-layout';

/** /account: the first signed-in page. Who you are, and the ways out. */
export function AccountPage() {
  return (
    <RequireAuth>
      <AccountContent />
    </RequireAuth>
  );
}

function AccountContent() {
  const { user } = useAuth();
  const { signOut, isSigningOut } = useSignOut();
  if (!user) return null;

  return (
    <AuthLayout title="Your account" heading={user.name}>
      <div className="flex flex-col gap-8 text-body-lg text-ink">
        <p className="break-all">{user.email}</p>
        <p className="text-body text-ink-muted">
          {user.roles.length === 0
            ? 'You have no active organization roles. An admin adds you to an organization.'
            : `Active roles in ${user.roles.length} organization${user.roles.length === 1 ? '' : 's'}.`}
        </p>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <PillButton size="lg" onClick={signOut} disabled={isSigningOut}>
            <LogOut aria-hidden="true" />
            {isSigningOut ? 'Signing out…' : 'Sign out'}
          </PillButton>
          <Link to="/change-password" className={TEXT_LINK}>
            Change password
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}
