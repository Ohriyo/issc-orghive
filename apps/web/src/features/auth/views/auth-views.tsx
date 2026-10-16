import { Link } from 'react-router';
import type { FieldErrors, UseFormRegister } from 'react-hook-form';
import { PillButton } from '@/components/pill-button';
import { TextField } from '@/components/text-field';
import { AuthLayout, FormAlert, TEXT_LINK } from './auth-layout';

/* Views only: they render presenter output and emit events. No fetching, no rules. */

interface FormProps<T extends Record<string, string>> {
  register: UseFormRegister<T>;
  errors: FieldErrors<T>;
  onSubmit: () => void;
  isSubmitting: boolean;
  formError?: string;
}

export function LoginView({
  register,
  errors,
  onSubmit,
  isSubmitting,
  formError,
}: FormProps<{ email: string; password: string }>) {
  return (
    <AuthLayout
      title="Sign in"
      heading="Sign in"
      intro={
        <p>
          For organization officers, advisers and ISSC admins. Students can browse Paperworks
          without an account.
        </p>
      }
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
        <FormAlert message={formError} />
        <TextField
          label="Email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <PillButton type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </PillButton>
          <Link to="/forgot-password" className={TEXT_LINK}>
            Forgot your password?
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordView({
  register,
  errors,
  onSubmit,
  isSubmitting,
  formError,
  isSent,
  sentTo,
}: FormProps<{ email: string }> & { isSent: boolean; sentTo?: string }) {
  if (isSent) {
    return (
      <AuthLayout title="Check your email" heading="Check your email">
        <div role="status" className="flex flex-col gap-6 text-body-lg text-ink">
          <p>
            If <strong className="font-semibold">{sentTo}</strong> has an Orghive account, a reset
            link is on its way. It works once and expires in 30 minutes.
          </p>
          <p className="text-body text-ink-muted">
            Nothing after a few minutes? Check your spam folder, or ask your organization&rsquo;s
            adviser which email your account uses.
          </p>
          <Link to="/login" className={TEXT_LINK}>
            Back to sign in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      heading="Reset your password"
      intro={
        <p>
          Enter your account&rsquo;s email and we will send you a link to choose a new password.
        </p>
      }
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
        <FormAlert message={formError} />
        <TextField
          label="Email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          error={errors.email?.message}
          {...register('email')}
        />
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <PillButton type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting ? 'Sending…' : 'Send reset link'}
          </PillButton>
          <Link to="/login" className={TEXT_LINK}>
            Back to sign in
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}

export function ResetPasswordView({
  register,
  errors,
  onSubmit,
  isSubmitting,
  formError,
  hasToken,
  isDone,
  isExpired,
  passwordHint,
}: FormProps<{ newPassword: string; confirmPassword: string }> & {
  hasToken: boolean;
  isDone: boolean;
  isExpired: boolean;
  passwordHint: string;
}) {
  if (isDone) {
    return (
      <AuthLayout title="Password changed" heading="Password changed">
        <div role="status" className="flex flex-col gap-6 text-body-lg text-ink">
          <p>Your new password is set, and every device that was signed in has been signed out.</p>
          <PillButton asChild size="lg" className="self-start">
            <Link to="/login">Sign in</Link>
          </PillButton>
        </div>
      </AuthLayout>
    );
  }

  if (!hasToken || isExpired) {
    return (
      <AuthLayout title="Reset link expired" heading="This link no longer works">
        <div className="flex flex-col gap-6 text-body-lg text-ink">
          <p>
            Reset links work once and expire after 30 minutes. Request a new one and use the latest
            email.
          </p>
          <PillButton asChild size="lg" className="self-start">
            <Link to="/forgot-password">Request a new link</Link>
          </PillButton>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" heading="Choose a new password">
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
        <FormAlert message={formError} />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          hint={passwordHint}
          error={errors.newPassword?.message}
          {...register('newPassword')}
        />
        <TextField
          label="Type it again"
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <PillButton type="submit" size="lg" disabled={isSubmitting} className="self-start">
          {isSubmitting ? 'Saving…' : 'Save new password'}
        </PillButton>
      </form>
    </AuthLayout>
  );
}

export function ChangePasswordView({
  register,
  errors,
  onSubmit,
  isSubmitting,
  formError,
  isForced,
  passwordHint,
}: FormProps<{ currentPassword: string; newPassword: string; confirmPassword: string }> & {
  isForced: boolean;
  passwordHint: string;
}) {
  return (
    <AuthLayout
      title="Change your password"
      heading={isForced ? 'Choose your own password' : 'Change your password'}
      intro={
        isForced ? (
          <p>
            You signed in with a temporary password. Replace it with one only you know to continue.
          </p>
        ) : (
          <p>Every other device signed in to your account will be signed out.</p>
        )
      }
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
        <FormAlert message={formError} />
        <TextField
          label={isForced ? 'Temporary password' : 'Current password'}
          type="password"
          autoComplete="current-password"
          error={errors.currentPassword?.message}
          {...register('currentPassword')}
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          hint={passwordHint}
          error={errors.newPassword?.message}
          {...register('newPassword')}
        />
        <TextField
          label="Type it again"
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <PillButton type="submit" size="lg" disabled={isSubmitting} className="self-start">
          {isSubmitting ? 'Saving…' : 'Save new password'}
        </PillButton>
      </form>
    </AuthLayout>
  );
}
