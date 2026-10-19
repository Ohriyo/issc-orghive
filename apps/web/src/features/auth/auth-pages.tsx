import { Navigate, useLocation, useSearchParams } from 'react-router';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { landingFor, useAuth } from './presenters/use-auth';
import {
  PASSWORD_HINT,
  useChangePassword,
  useForgotPassword,
  useLogin,
  useMfaSetup,
  useResetPassword,
  useResetTokenFromUrl,
} from './presenters/use-auth-forms';
import {
  ChangePasswordView,
  ForgotPasswordView,
  LoginView,
  ResetPasswordView,
} from './views/auth-views';
import { AuthSkeleton } from './views/auth-skeleton';
import { MfaCodeView, MfaSetupView } from './views/mfa-views';

/** /login. Someone already signed in goes straight on. Super admins get a code step. */
export function LoginPage() {
  usePageChrome(chrome.bare());
  const { status, user } = useAuth();
  const [params] = useSearchParams();
  const { mfa, ...login } = useLogin();
  if (status === 'authenticated' && user) {
    return <Navigate to={landingFor(user, params.get('next'))} replace />;
  }
  if (mfa) return <MfaCodeView {...mfa} />;
  return <LoginView {...login} />;
}

/**
 * /mfa-setup: a super admin's first sign-in confirms their authenticator. Anyone else (or a
 * super admin already set up, unless they are reading their new recovery codes) moves on.
 */
export function MfaSetupPage() {
  usePageChrome(chrome.bare());
  const { user } = useAuth();
  const setup = useMfaSetup();
  const moveOn = user && !user.mfaSetupRequired && !setup.recoveryCodes;
  return (
    <RequireAuth allowMfaSetup>
      {moveOn ? <Navigate to={landingFor(user, null)} replace /> : <MfaSetupView {...setup} />}
    </RequireAuth>
  );
}

export function ForgotPasswordPage() {
  usePageChrome(chrome.bare());
  return <ForgotPasswordView {...useForgotPassword()} />;
}

export function ResetPasswordPage() {
  usePageChrome(chrome.bare());
  const token = useResetTokenFromUrl();
  return <ResetPasswordForm key={token ?? 'none'} token={token} />;
}

function ResetPasswordForm({ token }: { token: string | undefined }) {
  return <ResetPasswordView {...useResetPassword(token)} passwordHint={PASSWORD_HINT} />;
}

/** /change-password: a signed-in page that a temporary password is allowed to reach. */
export function ChangePasswordPage() {
  const { user } = useAuth();
  const form = useChangePassword();
  // A temporary password must be changed first: nothing to go back to yet.
  usePageChrome(user?.mustChangePassword ? chrome.bare() : chrome.workspace('Change password'));
  return (
    <RequireAuth allowPasswordChange>
      <ChangePasswordView
        {...form}
        isForced={user?.mustChangePassword ?? false}
        passwordHint={PASSWORD_HINT}
      />
    </RequireAuth>
  );
}

/**
 * Route guard. Waits for the silent refresh, sends signed-out visitors to /login (keeping
 * where they were going), and holds a temporary password at /change-password.
 * The API enforces all of this too; the guard only keeps the interface honest.
 */
export function RequireAuth({
  children,
  allowPasswordChange = false,
  allowMfaSetup = false,
}: {
  children: React.ReactNode;
  allowPasswordChange?: boolean;
  /** Only /mfa-setup: a super admin without a confirmed authenticator may stay. */
  allowMfaSetup?: boolean;
}) {
  const { status, user } = useAuth();
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;

  if (status === 'unknown') return <AuthSkeleton />;
  if (status === 'anonymous' || !user) {
    return <Navigate to={`/login?next=${encodeURIComponent(here)}`} replace />;
  }
  if (user.mfaSetupRequired && !allowMfaSetup) return <Navigate to="/mfa-setup" replace />;
  if (user.mustChangePassword && !allowPasswordChange) {
    return <Navigate to={`/change-password?next=${encodeURIComponent(here)}`} replace />;
  }
  return children;
}
