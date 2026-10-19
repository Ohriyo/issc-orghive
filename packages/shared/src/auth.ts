import { z } from 'zod';
import { organizationTypeSchema } from './organization';

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

/**
 * The organization a shared account belongs to (docs/DOMAIN_RULES.md, "Accounts"). Every
 * account has exactly one, except the developer's SUPER_ADMIN, which has none.
 */
export const authOrganizationSchema = z.object({
  id: z.uuid(),
  type: organizationTypeSchema,
  slug: z.string(),
  acronym: z.string(),
  name: z.string(),
  /** An SBO's college CSC; a CSC's ISSC; null for the ISSC. */
  parentId: z.uuid().nullable(),
});
export type AuthOrganization = z.infer<typeof authOrganizationSchema>;

/** Who answers for a shared account this term, so the ISSC knows whom to reach. */
export const officerInChargeSchema = z.object({
  name: z.string(),
  position: z.string(),
  email: z.email(),
});
export type OfficerInCharge = z.infer<typeof officerInChargeSchema>;

/**
 * A system-level role, separate from organization memberships and from the ISSC `admin`
 * role. SUPER_ADMIN is the developer's console account (/system); it is created only by
 * the `create-super-admin` command and grants nothing inside organizations.
 */
export const systemRoleSchema = z.enum(['NONE', 'SUPER_ADMIN']);
export type SystemRole = z.infer<typeof systemRoleSchema>;

export const authUserSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    email: z.email(),
    mustChangePassword: z.boolean(),
    /** Null only for the developer's SUPER_ADMIN account. */
    organization: authOrganizationSchema.nullable(),
    officerInCharge: officerInChargeSchema.nullable(),
    /** The API always sends it; absent means NONE. */
    systemRole: systemRoleSchema.optional(),
    /** A super admin who has not confirmed their authenticator yet: only /mfa-setup opens. */
    mfaSetupRequired: z.boolean().optional(),
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

/** Super admins sign in with a password and a TOTP code (or a one-time recovery code). */
export const TOTP_CODE_LENGTH = 6;

/** Six digits from an authenticator app. Spaces are dropped ("123 456"). */
export const totpCodeSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'));

/**
 * A recovery code: 10 letters and digits, shown as "abcde-fghij". Case, spaces and the
 * dash do not matter.
 */
export const RECOVERY_CODE_COUNT = 10;
export const recoveryCodeSchema = z
  .string()
  .transform((value) => value.replace(/[\s-]+/g, '').toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9]{10}$/, 'Recovery codes have 10 letters and digits'));

/** A TOTP code or a recovery code: the second sign-in step accepts either. */
export const mfaCodeSchema = z
  .string()
  .trim()
  .min(1, 'Enter the code from your authenticator app')
  .max(32, 'That code is too long');

/** The second sign-in step's challenge: 32 random bytes, base64url (43 characters). */
export const mfaChallengeTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** POST /auth/login for a super admin: the password was right, now the code. No session yet. */
export const mfaChallengeSchema = z
  .object({
    mfaRequired: z.literal(true),
    challengeToken: mfaChallengeTokenSchema,
    /** Seconds the challenge stays valid. */
    expiresIn: z.number().int().positive(),
  })
  .meta({ id: 'MfaChallenge' });
export type MfaChallenge = z.infer<typeof mfaChallengeSchema>;

/** Body of POST /auth/login: a session, or a second step for super admins. */
export const loginResponseSchema = z.union([authResponseSchema, mfaChallengeSchema]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export function isMfaChallenge(body: LoginResponse): body is MfaChallenge {
  return 'mfaRequired' in body;
}

export const mfaVerifyRequestSchema = z.object({
  challengeToken: mfaChallengeTokenSchema,
  code: mfaCodeSchema,
});
export type MfaVerifyRequest = z.infer<typeof mfaVerifyRequestSchema>;

/** POST /auth/mfa/setup: confirms the authenticator the create-super-admin command set up. */
export const mfaSetupRequestSchema = z.object({ code: totpCodeSchema });
export type MfaSetupRequest = z.infer<typeof mfaSetupRequestSchema>;

/** The new session plus the recovery codes, shown once and never again. */
export const mfaSetupResponseSchema = authResponseSchema
  .extend({ recoveryCodes: z.array(z.string()).length(RECOVERY_CODE_COUNT) })
  .meta({ id: 'MfaSetupResponse' });
export type MfaSetupResponse = z.infer<typeof mfaSetupResponseSchema>;
