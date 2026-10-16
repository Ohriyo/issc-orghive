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
  loginRequestSchema,
  newPasswordSchema,
  resetTokenSchema,
} from '@orghive/shared';
import { api, ApiError, signOut } from '@/lib/api';
import { authStore } from '@/lib/auth-store';
import { safeNext } from './use-auth';

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

/** /login */
export function useLogin() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const form = useForm({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
  });
  const mutation = useMutation({
    mutationFn: (values: z.output<typeof loginRequestSchema>) =>
      api.post('/auth/login', values, { schema: authResponseSchema }),
    onSuccess: (auth) => {
      authStore.setSession(auth);
      const next = safeNext(params.get('next'));
      void navigate(
        auth.user.mustChangePassword ? `/change-password?next=${encodeURIComponent(next)}` : next,
        { replace: true },
      );
    },
    // Never keep a typed password around after a failed attempt.
    onError: () => form.resetField('password'),
  });

  return {
    register: form.register,
    errors: form.formState.errors,
    onSubmit: form.handleSubmit((values) => mutation.mutate(values)),
    isSubmitting: mutation.isPending,
    formError: formError(mutation.error),
  };
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
      void navigate(safeNext(params.get('next')), { replace: true });
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
