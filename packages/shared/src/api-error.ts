import { z } from 'zod';

/** Machine-readable error codes shared by the API and the web client. */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_JSON: 'INVALID_JSON',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** Login failed. Deliberately the same for an unknown email and a wrong password. */
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  /** Signed in with a temporary password: only changing it is allowed. */
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  /** The reset link is unknown, expired or already used. */
  INVALID_RESET_TOKEN: 'INVALID_RESET_TOKEN',
  FORBIDDEN: 'FORBIDDEN',
  /** 403: the organization is frozen (a report is overdue) and cannot create projects. */
  ORGANIZATION_FROZEN: 'ORGANIZATION_FROZEN',
  /** 403: an admin deactivated the organization; it cannot upload or create projects. */
  ORGANIZATION_INACTIVE: 'ORGANIZATION_INACTIVE',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Body of every non-2xx API response: `{ error: { code, message } }`. */
export const apiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;
