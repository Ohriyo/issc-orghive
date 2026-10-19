import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { ErrorCode, stepUpRequestSchema, stepUpResponseSchema } from '@orghive/shared';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { messageOf } from './system-format';

interface Pending {
  resume: () => void;
  cancel: () => void;
}

/**
 * Step-up for destructive console actions. `guard(action)` runs the action; when the API
 * answers STEP_UP_REQUIRED it opens the code dialog, and runs the action again once a fresh
 * code is accepted. It resolves undefined if the super admin cancels.
 */
export function useStepUp() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const pending = useRef<Pending | null>(null);
  const form = useForm({ resolver: zodResolver(stepUpRequestSchema), defaultValues: { code: '' } });

  const mutation = useMutation({
    mutationFn: (values: z.output<typeof stepUpRequestSchema>) =>
      api.post('/system/step-up', values, { schema: stepUpResponseSchema }),
    onSuccess: () => {
      setOpen(false);
      form.reset();
      void queryClient.invalidateQueries({ queryKey: queryKeys.system.security });
      const next = pending.current;
      pending.current = null;
      next?.resume();
    },
    onError: () => form.resetField('code'),
  });

  async function guard<T>(action: () => Promise<T>): Promise<T | undefined> {
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof ApiError && error.code === ErrorCode.STEP_UP_REQUIRED)) throw error;
      return new Promise<T | undefined>((resolve, reject) => {
        pending.current = {
          resume: () => void action().then(resolve, reject),
          cancel: () => resolve(undefined),
        };
        mutation.reset();
        setOpen(true);
      });
    }
  }

  const cancel = () => {
    setOpen(false);
    form.reset();
    pending.current?.cancel();
    pending.current = null;
  };

  return {
    guard,
    dialog: {
      open,
      register: form.register,
      errors: form.formState.errors,
      onSubmit: form.handleSubmit((values) => mutation.mutate(values)),
      isSubmitting: mutation.isPending,
      formError: mutation.error ? messageOf(mutation.error) : undefined,
      onCancel: cancel,
    },
  };
}

export type StepUpDialogModel = ReturnType<typeof useStepUp>['dialog'];
