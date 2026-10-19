import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import {
  authResponseSchema,
  changePasswordRequestSchema,
  ErrorCode,
  forgotPasswordRequestSchema,
  isMfaChallenge,
  loginRequestSchema,
  loginResponseSchema,
  mfaCodeSchema,
  mfaSetupResponseSchema,
  newPasswordSchema,
  resetTokenSchema,
  totpCodeSchema,
  type AuthResponse,
  type MfaChallenge,
} from '@orghive/shared';
import { api, ApiError, signOut } from '@/lib/api';
import { authStore } from '@/lib/auth-store';
import { landingFor } from './use-auth';

/** A message for the form, in the interface's voice. Never the raw server error for 5xx. */
function formError(error: unknown): string | undefined {
  if (!error) return undefined;
  if (error instanceof ApiError) {
    if (error.status === 0) return error.message;
    if (error.code === ErrorCode.RATE_LIMITED) return error.message;
    if (error.status < 500) return error.message;
  }
  return 'Something went wrong on our side. Try again in a moment.';
}

export const PASSWORD_HINT = 'At least 12 characters. A short sentence is easy to remember.';

const mfaCodeForm = z.object({ code: mfaCodeSchema });

/**
 * /login. A super admin's right password leads to a second step: a code from their
 * authenticator app, or one of their recovery codes.
 */
export function useLogin() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [usingRecoveryCode, setUsingRecoveryCode] = useState(false);
  const [expired, setExpired] = useState(false);
  const form = useForm({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
  });
  const codeForm = useForm({ resolver: zodResolver(mfaCodeForm), defaultValues: { code: '' } });

  const finish = (auth: AuthResponse) => {
    authStore.setSession(auth);
    void navigate(landingFor(auth.user, params.get('next')), { replace: true });
  };

  const mutation = useMutation({
    mutationFn: (values: z.output<typeof loginRequestSchema>) =>
      api.post('/auth/login', values, { schema: loginResponseSchema }),
    onSuccess: (body) => {
      if (isMfaChallenge(body)) {
        setExpired(false);
        setChallenge(body);
        form.resetField('password');
      } else {
        finish(body);
      }
    },
    // Never keep a typed password around after a failed attempt.
    onError: () => form.resetField('password'),
  });

  const verify = useMutation({
    mutationFn: ({ code }: z.output<typeof mfaCodeForm>) =>
      api.post(
        '/auth/mfa/verify',
        { challengeToken: challenge?.challengeToken, code },
        { schema: authResponseSchema },
      ),
    onSuccess: finish,
    onError: (error) => {
      codeForm.resetField('code');
      // The 5-minute challenge ran out: back to the password, with a word on why.
      if (error instanceof ApiError && error.status === 401) {
        setChallenge(null);
        setExpired(true);
      }
    },
  });

  const backToPassword = () => {
    setChallenge(null);
    setUsingRecoveryCode(false);
    codeForm.reset();
    verify.reset();
  };

  return {
    register: form.register,
    errors: form.formState.errors,
    onSubmit: form.handleSubmit((values) => mutation.mutate(values)),
    isSubmitting: mutation.isPending,
    formError: expired
      ? 'That sign-in took too long. Enter your password again.'
      : formError(mutation.error),
    /** Set while the second step (super admins) is showing. */
    mfa: challenge
      ? {
          register: codeForm.register,
          errors: codeForm.formState.errors,
          onSubmit: codeForm.handleSubmit((values) => verify.mutate(values)),
          isSubmitting: verify.isPending,
          formError: formError(verify.error),
          usingRecoveryCode,
          toggleRecoveryCode: () => {
            setUsingRecoveryCode((v) => !v);
            codeForm.reset();
            verify.reset();
          },
          backToPassword,
        }
      : null,
  };
}

export type LoginModel = ReturnType<typeof useLogin>;
export type MfaStepModel = NonNullable<LoginModel['mfa']>;

const setupCodeForm = z.object({ code: totpCodeSchema });

/**
 * /mfa-setup: a super admin confirms the authenticator the create-super-admin command set
 * up, with a first code. The answer is a full session and 10 recovery codes, shown once.
 */
export function useMfaSetup() {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const form = useForm({ resolver: zodResolver(setupCodeForm), defaultValues: { code: '' } });
  const mutation = useMutation({
    mutationFn: (values: z.output<typeof setupCodeForm>) =>
      api.post('/auth/mfa/setup', values, { schema: mfaSetupResponseSchema }),
    onError: () => form.resetField('code'),
  });
  const codes = mutation.data?.recoveryCodes ?? null;

  // The new session is stored only after the codes were seen: storing it on success would
  // re-render this page as "already set up" and move on before the codes ever showed.
  const finish = () => {
    if (!mutation.data) return;
    const { recoveryCodes: _shown, ...auth } = mutation.data;
    authStore.setSession(auth);
    void navigate('/system', { replace: true });
  };

  return {
    register: form.register,
    errors: form.formState.errors,
    onSubmit: form.handleSubmit((values) => mutation.mutate(values)),
    isSubmitting: mutation.isPending,
    formError: formError(mutation.error),
    recoveryCodes: codes,
    copied,
    copyCodes: () => {
      if (!codes) return;
      void navigator.clipboard?.writeText(codes.join('\n')).then(() => setCopied(true));
    },
    downloadCodes: () => codes && downloadRecoveryCodes(codes),
    finish,
  };
}

/** Saves the codes as a text file the super admin can store somewhere safe. */
export function downloadRecoveryCodes(codes: string[]) {
  const text = [
    'Orghive super admin recovery codes',
    'Each code works once, in place of a code from your authenticator app.',
    '',
    ...codes,
    '',
  ].join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'orghive-recovery-codes.txt';
  link.click();
  URL.revokeObjectURL(url);
}

/** /forgot-password */
export function useForgotPassword() {
  const form = useForm({
    resolver: zodResolver(forgotPasswordRequestSchema),
    defaultValues: { email: '' },
  });
  const mutation = useMutation({
    mutationFn: (values: z.output<typeof forgotPasswordRequestSchema>) =>
      api.post('/auth/forgot-password', values),
  });
  return {
    register: form.register,
    errors: form.formState.errors,
    onSubmit: form.handleSubmit((values) => mutation.mutate(values)),
    isSubmitting: mutation.isPending,
    isSent: mutation.isSuccess,
    sentTo: mutation.variables?.email,
    formError: formError(mutation.error),
  };
}

const newPasswordForm = z
  .object({ newPassword: newPasswordSchema, confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The two passwords do not match',
  });

function tokenFromHash(hash: string): string | undefined {
  const parsed = resetTokenSchema.safeParse(/(?:^#|&)token=([^&]+)/.exec(hash)?.[1]);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The one-time token from `#token=…`. It is kept in state and removed from the address
 * bar and history right away, so it is not left in the tab or shared by copying the URL.
 * A later link opened in the same tab (a fragment-only change) replaces it.
 */
export function useResetTokenFromUrl(): string | undefined {
  const { hash, pathname, search } = useLocation();
  const navigate = useNavigate();
  const [token, setToken] = useState(() => tokenFromHash(hash));
  const [seenHash, setSeenHash] = useState(hash);

  // Adjusting state during render when the input changes (react.dev "You might not need an effect").
  if (hash !== seenHash) {
    setSeenHash(hash);
    const next = tokenFromHash(hash);
    if (next) setToken(next);
  }

  useEffect(() => {
    if (hash) void navigate({ pathname, search }, { replace: true });
  }, [hash, pathname, search, navigate]);

  return token;
}

/** /reset-password#token=... Remount (key) per token so each link starts fresh. */
export function useResetPassword(token: string | undefined) {
  const form = useForm({
    resolver: zodResolver(newPasswordForm),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });
  const mutation = useMutation({
    mutationFn: (values: z.output<typeof newPasswordForm>) =>
      api.post('/auth/reset-password', { token, newPassword: values.newPassword }),
    // The API signed this account out everywhere; this tab included.
    onSuccess: () => authStore.clear(),
  });
  const expired =
    mutation.error instanceof ApiError && mutation.error.code === ErrorCode.INVALID_RESET_TOKEN;

  return {
    hasToken: Boolean(token),
    register: form.register,
    errors: form.formState.errors,
    onSubmit: form.handleSubmit((values) => mutation.mutate(values)),
    isSubmitting: mutation.isPending,
    isDone: mutation.isSuccess,
    isExpired: expired,
    formError: expired ? undefined : formError(mutation.error),
  };
}

const changePasswordForm = changePasswordRequestSchema
  .and(z.object({ confirmPassword: z.string() }))
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The two passwords do not match',
  });

/** /change-password, including the forced first change. */
export function useChangePassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const form = useForm({
    resolver: zodResolver(changePasswordForm),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const mutation = useMutation({
    mutationFn: ({ currentPassword, newPassword }: z.output<typeof changePasswordForm>) =>
      api.post(
        '/auth/change-password',
        { currentPassword, newPassword },
        { schema: authResponseSchema },
      ),
    onSuccess: (auth) => {
      authStore.setSession(auth);
      void navigate(landingFor(auth.user, params.get('next')), { replace: true });
    },
    onError: () => form.resetField('currentPassword'),
  });

  return {
    register: form.register,
    errors: form.formState.errors,
    onSubmit: form.handleSubmit((values) => mutation.mutate(values)),
    isSubmitting: mutation.isPending,
    formError: formError(mutation.error),
  };
}

/** Signs out on the server and drops every cached query, so no signed-in data outlives the session. */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: signOut,
    onSettled: () => {
      queryClient.clear();
      void navigate('/login', { replace: true });
    },
  });
  return { signOut: () => mutation.mutate(), isSigningOut: mutation.isPending };
}
