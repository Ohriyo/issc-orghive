import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { recoveryCodesResponseSchema, systemSecuritySchema } from '@orghive/shared';
import { downloadRecoveryCodes } from '@/features/auth/presenters/use-auth-forms';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatCount, formatDateTime, messageOf } from './system-format';
import { useStepUp } from './use-step-up';

/**
 * /system/security: the signed-in super admin's own session and MFA state, and new recovery
 * codes (a destructive action: the old ones stop working, so it needs a step-up).
 */
export function useSystemSecurity() {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const stepUp = useStepUp();
  const query = useQuery({
    queryKey: queryKeys.system.security,
    queryFn: () => api.get('/system/me/security', { schema: systemSecuritySchema }),
    staleTime: 30_000,
  });
  const regenerate = useMutation({
    mutationFn: () =>
      stepUp.guard(() =>
        api.post('/system/me/recovery-codes', undefined, { schema: recoveryCodesResponseSchema }),
      ),
    onSuccess: (result) => {
      if (!result) return;
      setCopied(false);
      toast.success('New recovery codes issued. The old ones no longer work.');
    },
    onError: (error) => toast.error(messageOf(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.system.security }),
  });
  const codes = regenerate.data?.recoveryCodes ?? null;

  const s = query.data;
  return {
    state: query.isPending
      ? ({ status: 'loading' } as const)
      : query.isError || !s
        ? ({ status: 'error', retry: () => void query.refetch() } as const)
        : ({
            status: 'ready',
            facts: [
              { label: 'Authenticator', value: `Confirmed ${formatDateTime(s.mfaEnabledAt)}` },
              {
                label: 'Recovery codes left',
                value: formatCount(s.recoveryCodesRemaining),
                attention: s.recoveryCodesRemaining <= 3,
              },
              { label: 'Signed in', value: formatDateTime(s.sessionStartedAt) },
              { label: 'Session ends by', value: formatDateTime(s.sessionExpiresAt) },
              {
                label: 'Idle timeout',
                value: `${Math.round(s.idleTimeoutSeconds / 60)} minutes without activity`,
              },
              {
                label: 'Step-up',
                value: s.stepUpExpiresAt
                  ? `Active until ${formatDateTime(s.stepUpExpiresAt)}`
                  : 'Not active. Destructive actions ask for a code.',
              },
            ] as { label: string; value: string; attention?: boolean }[],
          } as const),
    regenerate: () => regenerate.mutate(),
    isRegenerating: regenerate.isPending,
    recoveryCodes: codes,
    copied,
    copyCodes: () => {
      if (!codes) return;
      void navigator.clipboard?.writeText(codes.join('\n')).then(() => setCopied(true));
    },
    downloadCodes: () => codes && downloadRecoveryCodes(codes),
    stepUp: stepUp.dialog,
  };
}

export type SystemSecurityModel = ReturnType<typeof useSystemSecurity>;
