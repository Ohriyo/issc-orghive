import { Navigate, useLocation, useSearchParams } from 'react-router';
import { safeNext, useAuth } from './presenters/use-auth';
import {
  PASSWORD_HINT,
  useChangePassword,
  useForgotPassword,
  useLogin,
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

/** /login. Someone already signed in goes straight on. */
export function LoginPage() {
  const { status } = useAuth();
  const [params] = useSearchParams();
  const login = useLogin();
  if (status === 'authenticated') return <Navigate to={safeNext(params.get('next'))} replace />;
  return <LoginView {...login} />;
}

export function ForgotPasswordPage() {
  return <ForgotPasswordView {...useForgotPassword()} />;
}

export function ResetPasswordPage() {
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
}: {
  children: React.ReactNode;
  allowPasswordChange?: boolean;
}) {
  const { status, user } = useAuth();
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;

  if (status === 'unknown') return <AuthSkeleton />;
  if (status === 'anonymous' || !user) {
    return <Navigate to={`/login?next=${encodeURIComponent(here)}`} replace />;
  }
  if (user.mustChangePassword && !allowPasswordChange) {
    return <Navigate to={`/change-password?next=${encodeURIComponent(here)}`} replace />;
  }
  return children;
}
