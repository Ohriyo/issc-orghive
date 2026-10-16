import nodemailer from 'nodemailer';
import type { Config } from '#src/config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Outgoing email port. Services depend on this, so tests can capture mail in memory. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** SMTP mailer: mailpit locally (inbox at http://localhost:8025), a real relay in production. */
export function createSmtpMailer(
  config: Pick<
    Config,
    'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_SECURE' | 'SMTP_USER' | 'SMTP_PASS' | 'SMTP_FROM'
  >,
): Mailer {
  const transport = nodemailer.createTransport(
    {
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      ...(config.SMTP_USER && { auth: { user: config.SMTP_USER, pass: config.SMTP_PASS } }),
    },
    { from: config.SMTP_FROM },
  );
  return {
    async send(message) {
      await transport.sendMail(message);
    },
  };
}

/** Keeps sent mail in an array, for tests. */
export function memoryMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    send(message) {
      sent.push(message);
      return Promise.resolve();
    },
  };
}
