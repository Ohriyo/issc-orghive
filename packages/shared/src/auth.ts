import { z } from 'zod';
import { membershipRoleSchema } from './organization';

/**
 * 12 characters minimum (NIST SP 800-63B favours length over composition rules).
 * 128 maximum caps the Argon2 work a single request can cause.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Emails are compared case-insensitively, so they are trimmed and lowercased once, here. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** A new password. Login only checks length bounds, so older passwords still work. */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);

const anyPasswordSchema = z.string().min(1, 'Enter your password').max(PASSWORD_MAX_LENGTH);

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: anyPasswordSchema,
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const forgotPasswordRequestSchema = z.object({ email: emailSchema });
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

/** Reset tokens are 32 random bytes, base64url-encoded (43 characters). */
export const resetTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, 'This reset link is not valid');

export const resetPasswordRequestSchema = z.object({
  token: resetTokenSchema,
  newPassword: newPasswordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

export const changePasswordRequestSchema = z
  .object({ currentPassword: anyPasswordSchema, newPassword: newPasswordSchema })
  .refine((body) => body.newPassword !== body.currentPassword, {
    path: ['newPassword'],
    message: 'Choose a password different from your current one',
  });
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/** One active membership, as carried in the access token's `roles` claim. */
export const authRoleSchema = z.object({
  orgId: z.uuid(),
  role: membershipRoleSchema,
  isHead: z.boolean(),
});
export type AuthRole = z.infer<typeof authRoleSchema>;

export const authUserSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    email: z.email(),
    mustChangePassword: z.boolean(),
    roles: z.array(authRoleSchema),
  })
  .meta({ id: 'AuthUser' });
export type AuthUser = z.infer<typeof authUserSchema>;

/** Body of login, refresh and change-password responses. The refresh token travels only as a cookie. */
export const authResponseSchema = z
  .object({
    accessToken: z.string(),
    /** Seconds until the access token expires. */
    expiresIn: z.number().int().positive(),
    user: authUserSchema,
  })
  .meta({ id: 'AuthResponse' });
export type AuthResponse = z.infer<typeof authResponseSchema>;
