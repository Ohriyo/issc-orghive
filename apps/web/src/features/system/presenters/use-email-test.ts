import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { emailTestRequestSchema, emailTestResponseSchema } from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatDateTime, messageOf } from './system-format';

/**
 * /system/tools, test email: one message straight through the SMTP relay, to the super
 * admin's own address unless another is typed. The result (delivered, or what the relay
 * said) shows in place. Audited by the API.
 */
export function useEmailTest() {
  const queryClient = useQueryClient();
  const [to, setTo] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: (body: { to?: string }) =>
      api.post('/system/email-test', body, { schema: emailTestResponseSchema }),
    // The send is audited, and a failed relay shows on the health page too.
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.system.health }),
  });

  const result = send.data
    ? send.data.delivered
      ? ({
          tone: 'success',
          message: `Sent to ${send.data.to} at ${formatDateTime(send.data.sentAt)} in ${send.data.durationMs} ms. Check that inbox (and its spam folder).`,
        } as const)
      : ({
          tone: 'error',
          message: `The mail relay refused it: ${send.data.error ?? 'no reason given'}.`,
        } as const)
    : send.isError
      ? ({ tone: 'error', message: messageOf(send.error) } as const)
      : null;

  return {
    to,
    setTo: (value: string) => {
      setTo(value);
      setFieldError(null);
    },
    fieldError,
    sending: send.isPending,
    result,
    submit: (event?: { preventDefault: () => void }) => {
      event?.preventDefault();
      const typed = to.trim();
      const parsed = emailTestRequestSchema.safeParse(typed ? { to: typed } : {});
      if (!parsed.success) {
        setFieldError('Enter an email address, or leave it blank to use yours.');
        return;
      }
      send.mutate(parsed.data);
    },
  };
}

export type EmailTestModel = ReturnType<typeof useEmailTest>;
