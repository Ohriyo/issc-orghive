import { randomUUID } from 'node:crypto';
import {
  ErrorCode,
  type AuthOrganization,
  type AuthResponse,
  type AuthUser,
  type OfficerInCharge,
  type ChangePasswordRequest,
  type LoginRequest,
  type MfaChallenge,
  type MfaVerifyRequest,
  type ResetPasswordRequest,
  SUPER_ADMIN_SESSION_MAX_SECONDS,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { hashToken, randomToken } from '#src/lib/crypto';
import type { Mailer } from '#src/lib/mailer';
import type { PasswordHasher } from '#src/lib/password';
import { superAdminPasswordProblem } from '#src/lib/password-policy';
import type { Logger } from '#src/logger';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { AccountRepository } from '#src/repositories/account.repository';
import type { PasswordResetTokenRepository } from '#src/repositories/password-reset-token.repository';
import type { RefreshTokenRepository } from '#src/repositories/refresh-token.repository';
import type { UserCredentials, UserRepository } from '#src/repositories/user.repository';
import type { SuperAdminService } from '#src/services/super-admin.service';
import type { TokenService } from '#src/services/token.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Each refresh token lives 7 days; using it issues a new one (sliding window). */
export const REFRESH_TOKEN_TTL_MS = 7 * DAY_MS;
/** A session ends 30 days after login, however often it is refreshed. */
export const SESSION_MAX_AGE_MS = 30 * DAY_MS;
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
/** Super admin sessions end 8 hours after sign-in (and after 15 idle minutes). */
export const SUPER_ADMIN_SESSION_MAX_MS = SUPER_ADMIN_SESSION_MAX_SECONDS * 1000;

/** Request facts recorded in the audit log. */
export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

/** A refresh token to set as the httpOnly cookie. Never part of a response body. */
export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
}

export interface SessionResult {
  auth: AuthResponse;
  refresh: IssuedRefreshToken;
}

/** A super admin's correct password leads to the code step, not to a session. */
export type LoginResult =
  { kind: 'session'; session: SessionResult } | { kind: 'mfa'; challenge: MfaChallenge };

export interface AuthServiceDeps {
  users: Pick<UserRepository, 'findByEmail' | 'findById' | 'setPassword' | 'recordLogin'>;
  accounts: Pick<AccountRepository, 'findAccount' | 'findCurrentTerm'>;
  refreshTokens: Pick<
    RefreshTokenRepository,
    'create' | 'findByHash' | 'rotate' | 'revokeFamily' | 'revokeAllForUser'
  >;
  resetTokens: Pick<PasswordResetTokenRepository, 'create' | 'consume'>;
  audit: Pick<AuditLogRepository, 'record'>;
  tokens: Pick<TokenService, 'sign'>;
  superAdmins: Pick<
    SuperAdminService,
    | 'ensureNotLockedOut'
    | 'countFailure'
    | 'createChallenge'
    | 'completeChallenge'
    | 'confirmSetup'
    | 'startSession'
    | 'checkSession'
    | 'endSession'
  >;
  passwords: PasswordHasher;
  mailer: Mailer;
  logger: Logger;
  /** Origin of the web app, for links in emails. */
  webOrigin: string;
  now?: () => Date;
}

const invalidCredentials = () =>
  new AppError(401, ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password.');
/** Only after the correct password, so these never reveal which accounts exist. */
const accountDeactivated = () =>
  new AppError(
    403,
    ErrorCode.ACCOUNT_DEACTIVATED,
    'This account has been deactivated. Please contact the ISSC admin.',
  );
const accountLocked = () =>
  new AppError(
    403,
    ErrorCode.ACCOUNT_LOCKED,
    'This account is temporarily locked. Try again later or contact the ISSC admin.',
  );
const sessionEnded = () => AppError.unauthorized('Your session has ended. Sign in again.');

const isSuperAdmin = (user: UserCredentials) => user.systemRole === 'SUPER_ADMIN';
/** A super admin whose authenticator is not confirmed yet: only MFA setup opens. */
const mfaSetupPending = (user: UserCredentials) => isSuperAdmin(user) && !user.mfaEnabledAt;

/** Super admin passwords follow the stricter policy (14+ characters, not breached). */
function assertPasswordAllowed(user: UserCredentials, password: string) {
  if (!isSuperAdmin(user)) return;
  const problem = superAdminPasswordProblem(password, user);
  if (problem) throw new AppError(400, ErrorCode.VALIDATION_ERROR, problem);
}

export function createAuthService(deps: AuthServiceDeps) {
  const { users, accounts, refreshTokens, resetTokens, audit, tokens, passwords, superAdmins } =
    deps;
  const now = deps.now ?? (() => new Date());

  /** The shared account's organization and officer-in-charge (null for the super admin). */
  async function accountOf(
    userId: string,
  ): Promise<{ organization: AuthOrganization | null; officerInCharge: OfficerInCharge | null }> {
    const [account, term] = await Promise.all([
      accounts.findAccount(userId),
      accounts.findCurrentTerm(userId),
    ]);
    const org = account?.organization;
    return {
      organization: org
        ? {
            id: org.id,
            type: org.type,
            slug: org.slug,
            acronym: org.acronym,
            name: org.name,
            parentId: org.parentId,
          }
        : null,
      officerInCharge: term
        ? { name: term.officerName, position: term.officerPosition, email: term.officerEmail }
        : null,
    };
  }

  async function toAuthUser(user: UserCredentials): Promise<AuthUser> {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      mustChangePassword: user.mustChangePassword,
      ...(await accountOf(user.id)),
      systemRole: user.systemRole,
      mfaSetupRequired: mfaSetupPending(user),
    };
  }

  /** `sessionId` (the refresh family) is set for super admin sessions only. */
  async function accessFor(user: UserCredentials, sessionId?: string): Promise<AuthResponse> {
    const { token, expiresIn } = await tokens.sign({
      userId: user.id,
      passwordChangeRequired: user.mustChangePassword,
      systemRole: user.systemRole,
      ...(sessionId && { sessionId }),
      mfaSetupRequired: mfaSetupPending(user),
    });
    return { accessToken: token, expiresIn, user: await toAuthUser(user) };
  }

  /** Starts a new session (a new token family) for the user. */
  async function startSession(
    user: UserCredentials,
    ctx: RequestContext,
    at: Date,
  ): Promise<SessionResult> {
    const token = randomToken();
    const familyId = randomUUID();
    const superAdmin = isSuperAdmin(user);
    const sessionExpiresAt = new Date(
      at.getTime() + (superAdmin ? SUPER_ADMIN_SESSION_MAX_MS : SESSION_MAX_AGE_MS),
    );
    const expiresAt = new Date(
      Math.min(at.getTime() + REFRESH_TOKEN_TTL_MS, sessionExpiresAt.getTime()),
    );
    await refreshTokens.create({
      userId: user.id,
      tokenHash: hashToken(token),
      familyId,
      expiresAt,
      sessionExpiresAt,
      userAgent: ctx.userAgent?.slice(0, 255),
      ip: ctx.ip,
    });
    if (superAdmin) await superAdmins.startSession(familyId, at);
    return {
      auth: await accessFor(user, superAdmin ? familyId : undefined),
      refresh: { token, expiresAt },
    };
  }

  return {
    /**
     * Verifies the password with Argon2id. Every failure looks the same to the caller. A
     * super admin with a confirmed authenticator gets the code step instead of a session.
     */
    async login({ email, password }: LoginRequest, ctx: RequestContext): Promise<LoginResult> {
      const at = now();
      const user = await users.findByEmail(email);

      if (!user) {
        await passwords.verifyDummy(password);
        await audit.record({
          action: 'login_failed',
          entityType: 'user',
          metadata: { email, reason: 'unknown_email' },
          ip: ctx.ip,
        });
        throw invalidCredentials();
      }

      const superAdmin = isSuperAdmin(user);
      if (superAdmin) await superAdmins.ensureNotLockedOut(user.id, ctx);

      const valid = await passwords.verify(user.passwordHash, password);
      const blocked = !valid
        ? 'wrong_password'
        : user.disabledAt
          ? 'disabled'
          : user.lockedAt
            ? 'locked'
            : null;
      if (blocked) {
        await audit.record({
          action: 'login_failed',
          actorId: user.id,
          entityType: 'user',
          entityId: user.id,
          metadata: { reason: blocked },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
        if (superAdmin && !valid) await superAdmins.countFailure(user, ctx, 'password');
        // The reason is told only to someone who knows the password.
        if (blocked === 'disabled') throw accountDeactivated();
        if (blocked === 'locked') throw accountLocked();
        throw invalidCredentials();
      }

      if (superAdmin && user.mfaEnabledAt) {
        return { kind: 'mfa', challenge: await superAdmins.createChallenge(user.id) };
      }

      // A super admin without a confirmed authenticator gets a session that only reaches
      // MFA setup (the token's mfa_setup claim).
      const session = await startSession(user, ctx, at);
      await users.recordLogin(user.id, at);
      await audit.record({
        action: 'login',
        actorId: user.id,
        entityType: 'user',
        entityId: user.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        ...(superAdmin && { metadata: { mfa: 'setup_pending' } }),
      });
      return { kind: 'session', session };
    },

    /** The code step of a super admin sign-in: a TOTP code or a recovery code. */
    async verifyMfa(
      { challengeToken, code }: MfaVerifyRequest,
      ctx: RequestContext,
    ): Promise<SessionResult> {
      const { user, method } = await superAdmins.completeChallenge(challengeToken, code, ctx);
      const at = now();
      const session = await startSession(user, ctx, at);
      await users.recordLogin(user.id, at);
      await audit.record({
        action: 'login',
        actorId: user.id,
        entityType: 'user',
        entityId: user.id,
        metadata: { mfa: method },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return session;
    },

    /**
     * Confirms the super admin's authenticator. The restricted setup session ends and a
     * full one starts; the recovery codes are returned once.
     */
    async confirmMfaSetup(
      userId: string,
      sessionId: string | undefined,
      code: string,
      ctx: RequestContext,
    ): Promise<SessionResult & { recoveryCodes: string[] }> {
      const recoveryCodes = await superAdmins.confirmSetup(userId, code, ctx);
      const at = now();
      if (sessionId) {
        await refreshTokens.revokeFamily(sessionId, at);
        await superAdmins.endSession(sessionId);
      }
      const user = await users.findById(userId);
      if (!user || user.disabledAt) throw sessionEnded();
      return { ...(await startSession(user, ctx, at)), recoveryCodes };
    },

    /**
     * Rotates the refresh token: the presented one is revoked and a new one issued in the
     * same family. Presenting a token that was already rotated means it was copied, so the
     * whole family is revoked and both holders must sign in again.
     */
    async refresh(token: string, ctx: RequestContext): Promise<SessionResult> {
      const at = now();
      const current = await refreshTokens.findByHash(hashToken(token));
      if (!current) throw sessionEnded();

      const reuse = async () => {
        await refreshTokens.revokeFamily(current.familyId, at);
        await audit.record({
          action: 'token_reuse',
          actorId: current.userId,
          entityType: 'refresh_token_family',
          entityId: current.familyId,
          ip: ctx.ip,
        });
        deps.logger.warn(
          { userId: current.userId, familyId: current.familyId },
          'Refresh token reuse detected; session revoked',
        );
        return sessionEnded();
      };

      if (current.revokedAt) {
        // Rotated before: reuse. Revoked without a successor (logout, reset): just ended.
        if (current.replacedById) throw await reuse();
        throw sessionEnded();
      }
      if (current.expiresAt <= at || current.sessionExpiresAt <= at) throw sessionEnded();

      const user = await users.findById(current.userId);
      // Deactivated or locked since the last refresh: the session is over.
      if (!user || user.disabledAt || user.lockedAt) {
        await refreshTokens.revokeFamily(current.familyId, at);
        throw sessionEnded();
      }
      // Ends an idle (15 min) or old (8 h) super admin session; a refresh is not activity.
      // A user promoted mid-session has no super admin session yet and signs in again.
      if (isSuperAdmin(user)) {
        await superAdmins.checkSession(current.familyId, { background: true });
      }

      const next = randomToken();
      const expiresAt = new Date(
        Math.min(at.getTime() + REFRESH_TOKEN_TTL_MS, current.sessionExpiresAt.getTime()),
      );
      const rotated = await refreshTokens.rotate(
        current.id,
        {
          userId: user.id,
          tokenHash: hashToken(next),
          familyId: current.familyId,
          expiresAt,
          sessionExpiresAt: current.sessionExpiresAt,
          userAgent: ctx.userAgent?.slice(0, 255),
          ip: ctx.ip,
        },
        at,
      );
      // Another request rotated this token first: the same token was used twice.
      if (!rotated) throw await reuse();

      return {
        auth: await accessFor(user, isSuperAdmin(user) ? current.familyId : undefined),
        refresh: { token: next, expiresAt },
      };
    },

    /** Ends the session the cookie belongs to. Succeeds quietly when there is none. */
    async logout(token: string | undefined, ctx: RequestContext): Promise<void> {
      if (!token) return;
      const current = await refreshTokens.findByHash(hashToken(token));
      if (!current) return;
      await refreshTokens.revokeFamily(current.familyId, now());
      await superAdmins.endSession(current.familyId);
      await audit.record({
        action: 'logout',
        actorId: current.userId,
        entityType: 'user',
        entityId: current.userId,
        ip: ctx.ip,
      });
    },

    /**
     * Emails a one-time reset link when the account exists. The caller always answers the
     * same way, so the response never reveals whether an email is registered.
     */
    async requestPasswordReset(email: string, ctx: RequestContext): Promise<void> {
      const at = now();
      const user = await users.findByEmail(email);
      if (!user || user.disabledAt) return;

      const token = randomToken();
      await resetTokens.create(
        {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(at.getTime() + RESET_TOKEN_TTL_MS),
        },
        at,
      );
      await audit.record({
        action: 'password_reset_requested',
        actorId: user.id,
        entityType: 'user',
        entityId: user.id,
        ip: ctx.ip,
      });

      // The token rides in the URL fragment, which browsers never send to a server, so it
      // stays out of access logs and Referer headers.
      const link = `${deps.webOrigin}/reset-password#token=${token}`;
      // Not awaited: an SMTP round-trip would make this response slower for registered
      // emails than for unknown ones.
      void deps.mailer
        .send({
          to: user.email,
          subject: 'Reset your Orghive password',
          text: [
            `Hi ${user.name},`,
            '',
            'Someone asked to reset the password for your Orghive account. To choose a new password, open this link within 30 minutes:',
            '',
            link,
            '',
            'If it was not you, ignore this email. Your password stays the same.',
          ].join('\n'),
          html: `<p>Hi ${escapeHtml(user.name)},</p><p>Someone asked to reset the password for your Orghive account. To choose a new password, open this link within 30 minutes:</p><p><a href="${escapeHtml(link)}">Reset your password</a></p><p>If it was not you, ignore this email. Your password stays the same.</p>`,
        })
        .catch((err: unknown) =>
          deps.logger.error({ err, userId: user.id }, 'Password reset email failed'),
        );
    },

    /** Sets a new password from a reset link and signs the user out everywhere. */
    async resetPassword(
      { token, newPassword }: ResetPasswordRequest,
      ctx: RequestContext,
    ): Promise<void> {
      const at = now();
      const userId = await resetTokens.consume(hashToken(token), at);
      if (!userId) {
        throw new AppError(
          400,
          ErrorCode.INVALID_RESET_TOKEN,
          'This reset link has expired or was already used. Request a new one.',
        );
      }
      const user = await users.findById(userId);
      if (user) assertPasswordAllowed(user, newPassword);
      await users.setPassword(userId, await passwords.hash(newPassword), at);
      await refreshTokens.revokeAllForUser(userId, at);
      await audit.record({
        action: 'password_reset',
        actorId: userId,
        entityType: 'user',
        entityId: userId,
        ip: ctx.ip,
      });
    },

    /**
     * Replaces the password (including the forced first change). Every other session ends;
     * the caller gets a fresh one.
     */
    async changePassword(
      userId: string,
      { currentPassword, newPassword }: ChangePasswordRequest,
      ctx: RequestContext,
    ): Promise<SessionResult> {
      const at = now();
      const user = await users.findById(userId);
      if (!user || user.disabledAt) throw sessionEnded();

      // 400, not 401: the session is fine, only the typed password is wrong.
      if (!(await passwords.verify(user.passwordHash, currentPassword))) {
        throw new AppError(
          400,
          ErrorCode.INVALID_CREDENTIALS,
          'Your current password is incorrect',
        );
      }

      assertPasswordAllowed(user, newPassword);
      await users.setPassword(user.id, await passwords.hash(newPassword), at);
      await refreshTokens.revokeAllForUser(user.id, at);
      await audit.record({
        action: 'password_change',
        actorId: user.id,
        entityType: 'user',
        entityId: user.id,
        metadata: { forced: user.mustChangePassword },
        ip: ctx.ip,
      });
      return startSession({ ...user, mustChangePassword: false }, ctx, at);
    },

    /** The signed-in user, with fresh roles. */
    async me(userId: string): Promise<AuthUser> {
      const user = await users.findById(userId);
      if (!user || user.disabledAt || user.lockedAt) throw sessionEnded();
      return toAuthUser(user);
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export type AuthService = ReturnType<typeof createAuthService>;
