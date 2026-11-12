import type { EmailTestResponse } from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import type { Mailer } from '#src/lib/mailer';
import type { Logger } from '#src/logger';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { UserRepository } from '#src/repositories/user.repository';
import type { ConsoleActor } from '#src/services/account-admin.service';
import { withTimeout } from '#src/services/system-health.service';

export interface EmailTestServiceDeps {
  mailer: Mailer;
  users: Pick<UserRepository, 'findById'>;
  audit: Pick<AuditLogRepository, 'record'>;
  logger: Logger;
  now?: () => Date;
  /** How long the SMTP relay may take before the test counts as failed. */
  timeoutMs?: number;
}

const ERROR_MAX = 300;

/**
 * /system/email-test: sends one plain message straight through the SMTP relay (not the
 * notification queue), so the super admin sees at once whether mail works and, if not,
 * what the relay said. Audited either way.
 */
export function createEmailTestService({
  mailer,
  users,
  audit,
  logger,
  now = () => new Date(),
  timeoutMs = 15_000,
}: EmailTestServiceDeps) {
  return {
    async send(actor: ConsoleActor, to: string | undefined): Promise<EmailTestResponse> {
      const recipient = to ?? (await users.findById(actor.userId))?.email;
      if (!recipient) throw AppError.notFound('Your account has no email to send the test to');

      const sentAt = now();
      const started = Date.now();
      let error: string | null = null;
      try {
        await withTimeout(
          mailer.send({
            to: recipient,
            subject: 'Orghive test email',
            text: `This is a test email from the Orghive system console, sent at ${sentAt.toISOString()}. If you can read it, outgoing email works. No action is needed.`,
            html: `<p>This is a test email from the Orghive system console, sent at ${sentAt.toISOString()}.</p><p>If you can read it, outgoing email works. No action is needed.</p>`,
          }),
          timeoutMs,
        );
      } catch (err) {
        error = (err instanceof Error ? err.message : String(err)).slice(0, ERROR_MAX);
        logger.warn({ err }, 'Test email failed');
      }
      const durationMs = Date.now() - started;

      await audit.record({
        action: 'email_test',
        actorId: actor.userId,
        entityType: 'email',
        metadata: { to: recipient, delivered: error === null, error, durationMs },
        ip: actor.ctx.ip,
        userAgent: actor.ctx.userAgent,
      });
      return {
        to: recipient,
        delivered: error === null,
        error,
        durationMs,
        sentAt: sentAt.toISOString(),
      };
    },
  };
}

export type EmailTestService = ReturnType<typeof createEmailTestService>;
