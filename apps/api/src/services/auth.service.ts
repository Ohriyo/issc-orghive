import { randomUUID } from 'node:crypto';
import {
  ErrorCode,
  type AuthResponse,
  type AuthRole,
  type AuthUser,
  type ChangePasswordRequest,
  type LoginRequest,
  type ResetPasswordRequest,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { hashToken, randomToken } from '#src/lib/crypto';
import type { Mailer } from '#src/lib/mailer';
import type { PasswordHasher } from '#src/lib/password';
import type { Logger } from '#src/logger';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { MembershipRepository } from '#src/repositories/membership.repository';
import type { PasswordResetTokenRepository } from '#src/repositories/password-reset-token.repository';
import type { RefreshTokenRepository } from '#src/repositories/refresh-token.repository';
import type { UserCredentials, UserRepository } from '#src/repositories/user.repository';
import type { TokenService } from '#src/services/token.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Each refresh token lives 7 days; using it issues a new one (sliding window). */
export const REFRESH_TOKEN_TTL_MS = 7 * DAY_MS;
/** A session ends 30 days after login, however often it is refreshed. */
export const SESSION_MAX_AGE_MS = 30 * DAY_MS;
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

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

export interface AuthServiceDeps {
  users: Pick<UserRepository, 'findByEmail' | 'findById' | 'setPassword'>;
  memberships: Pick<MembershipRepository, 'findActiveForUser'>;
  refreshTokens: Pick<
    RefreshTokenRepository,
    'create' | 'findByHash' | 'rotate' | 'revokeFamily' | 'revokeAllForUser'
  >;
  resetTokens: Pick<PasswordResetTokenRepository, 'create' | 'consume'>;
  audit: Pick<AuditLogRepository, 'record'>;
  tokens: Pick<TokenService, 'sign'>;
  passwords: PasswordHasher;
  mailer: Mailer;
  logger: Logger;
  /** Origin of the web app, for links in emails. */
  webOrigin: string;
  now?: () => Date;
}

const invalidCredentials = () =>
  new AppError(401, ErrorCode.INVALID_CREDENTIALS, 'Email or password is incorrect');
const sessionEnded = () => AppError.unauthorized('Your session has ended. Sign in again.');

export function createAuthService(deps: AuthServiceDeps) {
  const { users, memberships, refreshTokens, resetTokens, audit, tokens, passwords } = deps;
  const now = deps.now ?? (() => new Date());

  async function rolesOf(userId: string, at: Date) {
    const active = await memberships.findActiveForUser(userId, at);
    const roles: AuthRole[] = active.map((m) => ({
      orgId: m.organization.id,
      role: m.role,
      isHead: m.isHead,
    }));
    const isAdmin = active.some((m) => m.role === 'admin' && m.organization.type === 'ISSC');
    return { roles, isAdmin };
  }

  async function toAuthUser(user: UserCredentials, at: Date): Promise<AuthUser> {
    const { roles } = await rolesOf(user.id, at);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      mustChangePassword: user.mustChangePassword,
      roles,
    };
  }

  async function accessFor(user: UserCredentials, at: Date): Promise<AuthResponse> {
    const { roles, isAdmin } = await rolesOf(user.id, at);
    const { token, expiresIn } = await tokens.sign({
      userId: user.id,
      roles,
      isAdmin,
      passwordChangeRequired: user.mustChangePassword,
    });
    return {
      accessToken: token,
      expiresIn,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        mustChangePassword: user.mustChangePassword,
        roles,
      },
    };
  }

  /** Starts a new session (a new token family) for the user. */
  async function startSession(
    user: UserCredentials,
    ctx: RequestContext,
    at: Date,
  ): Promise<SessionResult> {
    const token = randomToken();
    const sessionExpiresAt = new Date(at.getTime() + SESSION_MAX_AGE_MS);
    const expiresAt = new Date(at.getTime() + REFRESH_TOKEN_TTL_MS);
    await refreshTokens.create({
      userId: user.id,
      tokenHash: hashToken(token),
      familyId: randomUUID(),
      expiresAt,
      sessionExpiresAt,
      userAgent: ctx.userAgent?.slice(0, 255),
    });
    return { auth: await accessFor(user, at), refresh: { token, expiresAt } };
  }

  return {
    /** Verifies the password with Argon2id. Every failure looks the same to the caller. */
    async login({ email, password }: LoginRequest, ctx: RequestContext): Promise<SessionResult> {
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

      const valid = await passwords.verify(user.passwordHash, password);
      if (!valid || user.disabledAt) {
        await audit.record({
          action: 'login_failed',
          actorId: user.id,
          entityType: 'user',
          entityId: user.id,
          metadata: { reason: valid ? 'disabled' : 'wrong_password' },
          ip: ctx.ip,
        });
        throw invalidCredentials();
      }

      const session = await startSession(user, ctx, at);
      await audit.record({
        action: 'login',
        actorId: user.id,
        entityType: 'user',
        entityId: user.id,
        ip: ctx.ip,
      });
      return session;
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
      if (!user || user.disabledAt) {
        await refreshTokens.revokeFamily(current.familyId, at);
        throw sessionEnded();
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
        },
        at,
      );
      // Another request rotated this token first: the same token was used twice.
      if (!rotated) throw await reuse();

      return { auth: await accessFor(user, at), refresh: { token: next, expiresAt } };
    },

    /** Ends the session the cookie belongs to. Succeeds quietly when there is none. */
    async logout(token: string | undefined, ctx: RequestContext): Promise<void> {
      if (!token) return;
      const current = await refreshTokens.findByHash(hashToken(token));
      if (!current) return;
      await refreshTokens.revokeFamily(current.familyId, now());
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
      if (!user || user.disabledAt) throw sessionEnded();
      return toAuthUser(user, now());
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
