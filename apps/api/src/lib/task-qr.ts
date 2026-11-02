import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import {
  TASK_CODE_ALPHABET,
  TASK_CODE_RANDOM_LENGTH,
  TASK_CODE_SUFFIXES,
  isTaskCode,
  type CheckedTaskType,
} from '@orghive/shared';

/**
 * The QR code on a project task's template (docs/PROJECT_WORKFLOW_SPEC.md, section 6): an
 * HMAC-signed payload naming the task code, the project task and the organization.
 *
 *   OH1.<code>.<task id>.<org id>.<signature>
 *
 * Ids are base64url (22 characters each) and the signature is truncated to 128 bits, so the
 * content stays short enough for a QR whose modules survive printing and scanning. The task
 * type is the code's suffix.
 */
export interface TaskQrPayload {
  code: string;
  taskId: string;
  organizationId: string;
}

const VERSION = 'OH1';
const SIGNATURE_LENGTH = 22;

function uuidToBase64url(uuid: string): string {
  return Buffer.from(uuid.replaceAll('-', ''), 'hex').toString('base64url');
}

function base64urlToUuid(text: string): string | null {
  const hex = Buffer.from(text, 'base64url').toString('hex');
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createTaskQr(secret: string) {
  const key = Buffer.from(secret, 'base64');
  const sign = (body: string) =>
    createHmac('sha256', key).update(body).digest('base64url').slice(0, SIGNATURE_LENGTH);

  return {
    /** The QR's content for a task code. */
    contentOf(payload: TaskQrPayload): string {
      const body = [
        VERSION,
        payload.code,
        uuidToBase64url(payload.taskId),
        uuidToBase64url(payload.organizationId),
      ].join('.');
      return `${body}.${sign(body)}`;
    },

    /** The payload of a QR this server signed; null for anything else (or a forged one). */
    verify(content: string): TaskQrPayload | null {
      const parts = content.trim().split('.');
      if (parts.length !== 5 || parts[0] !== VERSION) return null;
      const [, code, task, org, signature] = parts as [string, string, string, string, string];
      const expected = Buffer.from(sign(parts.slice(0, 4).join('.')));
      const given = Buffer.from(signature);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
      const taskId = base64urlToUuid(task);
      const organizationId = base64urlToUuid(org);
      if (!isTaskCode(code) || !taskId || !organizationId) return null;
      return { code, taskId, organizationId };
    },
  };
}

export type TaskQr = ReturnType<typeof createTaskQr>;

/** A fresh short code for a task, e.g. OH-7K3P-ACR (unique by the database; retry on clash). */
export function generateTaskCode(
  type: CheckedTaskType,
  random: (max: number) => number = randomInt,
): string {
  let part = '';
  for (let i = 0; i < TASK_CODE_RANDOM_LENGTH; i++) {
    part += TASK_CODE_ALPHABET[random(TASK_CODE_ALPHABET.length)];
  }
  return `OH-${part}-${TASK_CODE_SUFFIXES[type]}`;
}
