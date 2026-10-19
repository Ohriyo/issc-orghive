import {
  ErrorCode,
  STEP_UP_TTL_SECONDS,
  SUPER_ADMIN_IDLE_TIMEOUT_SECONDS,
  SUPER_ADMIN_SESSION_MAX_SECONDS,
  totpCodeSchema,
  type MfaChallenge,
  type SystemSecurity,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { hashToken, randomToken } from '#src/lib/crypto';
import type { Mailer } from '#src/lib/mailer';
import type { PasswordHasher } from '#src/lib/password';
import { generateRecoveryCodes, normalizeRecoveryCode } from '#src/lib/recovery-codes';
import type { SecretBox } from '#src/lib/secret-box';
import type { SuperAdminStore } from '#src/lib/super-admin-store';
import type { Totp } from '#src/lib/totp';
import type { Logger } from '#src/logger';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { RecoveryCodeRepository } from '#src/repositories/recovery-code.repository';
import type { RefreshTokenRepository } from '#src/repositories/refresh-token.repository';
import type { SystemRepository } from '#src/repositories/system.repository';
import type { UserCredentials, UserRepository } from '#src/repositories/user.repository';
import type { RequestContext } from '#src/services/auth.service';

/*
 * Super admin MFA and sessions (CLAUDE.md, "System roles"): the code step of sign-in,
 * authenticator setup, step-up for destructive actions, recovery codes, the separate
 * lockout, and the 15-minute idle / 8-hour session limits.
 */

/** The password was right; the code must follow within 5 minutes. */
export const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;
/** Failed super admin passwords and codes, per account and per IP, before a lockout. */
export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_WINDOW_SECONDS = 15 * 60;

export type FailureStage = 'password' | 'login' | 'setup' | 'step_up';
export type MfaMethod = 'totp' | 'recovery';

export interface SuperAdminServiceDeps {
  users: Pick<UserRepository, 'findById' | 'recordTotpStep' | 'enableMfa'>;
  recoveryCodes: Pick<
    RecoveryCodeRepository,
    'listUnused' | 'countUnused' | 'markUsed' | 'replaceAll'
  >;
  system: Pick<SystemRepository, 'activeSuperAdminEmails'>;
  refreshTokens: Pick<RefreshTokenRepository, 'revokeFamily'>;
  store: SuperAdminStore;
  totp: Totp;
  /** Null when MFA_ENCRYPTION_KEY is not set: no super admin can finish signing in. */
  secrets: SecretBox | null;
  passwords: PasswordHasher;
  audit: Pick<AuditLogRepository, 'record'>;
  mailer: Mailer;
  logger: Logger;
  now?: () => Date;
}

const invalidCode = () =>
  new AppError(
    400,
    ErrorCode.INVALID_MFA_CODE,
    'That code is not right. Check your authenticator app and try again.',
  );
const challengeExpired = () =>
  new AppError(
    401,
    ErrorCode.INVALID_MFA_CODE,
    'This sign-in has expired. Enter your password again.',
  );
const lockedOut = () =>
  new AppError(
    429,
    ErrorCode.RATE_LIMITED,
    `Too many attempts. Try again in ${LOCKOUT_WINDOW_SECONDS / 60} minutes.`,
  );
const sessionEnded = () =>
  AppError.unauthorized('Your session ended after a period without activity. Sign in again.');

function auditContext(ctx: RequestContext) {
  return { ip: ctx.ip, userAgent: ctx.userAgent };
}

/** Six digits (spaces allowed) is a TOTP code; anything else is tried as a recovery code. */
function methodOf(code: string): MfaMethod {
  return /^\d{6}$/.test(code.replace(/\s+/g, '')) ? 'totp' : 'recovery';
}

export function createSuperAdminService(deps: SuperAdminServiceDeps) {
  const { users, recoveryCodes, store, totp, passwords, audit } = deps;
  const now = deps.now ?? (() => new Date());

  const failureKeys = (userId: string, ctx: RequestContext) => [
    `acct:${userId}`,
    ...(ctx.ip ? [`ip:${ctx.ip}`] : []),
  ];

  function secretOf(user: Pick<UserCredentials, 'id' | 'mfaSecret'>): string {
    if (!deps.secrets) throw new Error('MFA_ENCRYPTION_KEY is not set');
    if (!user.mfaSecret) throw new Error('This super admin has no authenticator secret');
    return deps.secrets.open(user.mfaSecret, user.id);
  }

  /** A TOTP code that has not been used before. Records its time step on success. */
  async function checkTotp(user: UserCredentials, code: string, at: Date): Promise<boolean> {
    const parsed = totpCodeSchema.safeParse(code);
    if (!parsed.success) return false;
    const step = await totp.verify(secretOf(user), parsed.data, {
      at,
      afterTimeStep: user.mfaLastTimeStep,
    });
    return step !== null && (await users.recordTotpStep(user.id, step));
  }

  /** An unused recovery code; it is spent on success. Returns how many remain. */
  async function checkRecoveryCode(userId: string, code: string, at: Date) {
    const normalized = normalizeRecoveryCode(code);
    if (!normalized) return null;
    for (const stored of await recoveryCodes.listUnused(userId)) {
      if (await passwords.verify(stored.codeHash, normalized)) {
        if (!(await recoveryCodes.markUsed(stored.id, at))) return null;
        return { remaining: await recoveryCodes.countUnused(userId) };
      }
    }
    return null;
  }

  async function issueRecoveryCodes(): Promise<{ codes: string[]; hashes: string[] }> {
    const codes = generateRecoveryCodes();
    const hashes = await Promise.all(
      codes.map((code) => passwords.hash(normalizeRecoveryCode(code)!)),
    );
    return { codes, hashes };
  }

  async function alertLockout(
    user: Pick<UserCredentials, 'id' | 'email'>,
    ctx: RequestContext,
    stage: FailureStage,
  ) {
    await audit.record({
      action: 'super_admin_lockout',
      actorId: user.id,
      entityType: 'user',
      entityId: user.id,
      metadata: { stage, windowMinutes: LOCKOUT_WINDOW_SECONDS / 60 },
      ...auditContext(ctx),
    });
    deps.logger.error(
      { userId: user.id, ip: ctx.ip, stage },
      'Super admin locked out after repeated failed attempts',
    );
    const recipients = new Set([...(await deps.system.activeSuperAdminEmails()), user.email]);
    const lines = [
      'Orghive locked a super admin account after repeated failed sign-in or code attempts.',
      '',
      `Account: ${user.email}`,
      `From IP: ${ctx.ip ?? 'unknown'}`,
      `Stage: ${stage}`,
      `Locked for: ${LOCKOUT_WINDOW_SECONDS / 60} minutes`,
      '',
      'If this was not you, review the audit log at /system/audit and consider resetting the password and authenticator with the create-super-admin command.',
    ];
    const text = lines.join('\n');
    const html = lines
      .filter(Boolean)
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join('');
    // Not awaited: the attacker's response should not wait on SMTP.
    for (const to of recipients) {
      void deps.mailer
        .send({ to, subject: 'Orghive: super admin account locked', text, html })
        .catch((err: unknown) => deps.logger.error({ err }, 'Lockout alert email failed'));
    }
  }

  /** 429 while the account or the IP has 5 recent failures. Call before any check. */
  async function ensureNotLockedOut(userId: string, ctx: RequestContext): Promise<void> {
    const counts = await store.failureCounts(failureKeys(userId, ctx));
    if (counts.some((count) => count >= LOCKOUT_THRESHOLD)) throw lockedOut();
  }

  /** Counts a failed password or code; the fifth in 15 minutes locks and alerts, once. */
  async function countFailure(
    user: Pick<UserCredentials, 'id' | 'email'>,
    ctx: RequestContext,
    stage: FailureStage,
  ): Promise<void> {
    const counts = await store.addFailure(failureKeys(user.id, ctx), LOCKOUT_WINDOW_SECONDS);
    if (
      counts.some((count) => count >= LOCKOUT_THRESHOLD) &&
      (await store.claimAlert(`acct:${user.id}`, LOCKOUT_WINDOW_SECONDS))
    ) {
      await alertLockout(user, ctx, stage);
    }
  }

  async function startSession(sessionId: string, at: Date): Promise<void> {
    // The TTL only cleans up; checkSession compares the times itself.
    await store.startSession(sessionId, at, SUPER_ADMIN_SESSION_MAX_SECONDS + 60);
  }

  return {
    ensureNotLockedOut,

    countFailure,

    /** After a correct password: the token the code step must present. Stored hashed. */
    async createChallenge(userId: string): Promise<MfaChallenge> {
      const token = randomToken();
      await store.createChallenge(hashToken(token), userId, MFA_CHALLENGE_TTL_SECONDS);
      return { mfaRequired: true, challengeToken: token, expiresIn: MFA_CHALLENGE_TTL_SECONDS };
    },

    /**
     * The code step of sign-in: a TOTP code or a recovery code. A wrong code keeps the
     * challenge (typos happen) but counts toward the lockout; a right one spends it.
     */
    async completeChallenge(
      challengeToken: string,
      code: string,
      ctx: RequestContext,
    ): Promise<{ user: UserCredentials; method: MfaMethod }> {
      const at = now();
      const hash = hashToken(challengeToken);
      const userId = await store.getChallenge(hash);
      if (!userId) throw challengeExpired();

      const user = await users.findById(userId);
      if (!user || user.disabledAt || user.systemRole !== 'SUPER_ADMIN' || !user.mfaEnabledAt) {
        await store.consumeChallenge(hash);
        throw challengeExpired();
      }
      await ensureNotLockedOut(user.id, ctx);

      const method = methodOf(code);
      const recovery =
        method === 'recovery' ? await checkRecoveryCode(user.id, code, at) : undefined;
      const ok = method === 'totp' ? await checkTotp(user, code, at) : recovery != null;
      if (!ok) {
        await audit.record({
          action: 'mfa_failed',
          actorId: user.id,
          entityType: 'user',
          entityId: user.id,
          metadata: { stage: 'login', method },
          ...auditContext(ctx),
        });
        await countFailure(user, ctx, 'login');
        throw invalidCode();
      }
      if (!(await store.consumeChallenge(hash))) throw challengeExpired();

      if (recovery) {
        await audit.record({
          action: 'mfa_recovery_used',
          actorId: user.id,
          entityType: 'user',
          entityId: user.id,
          metadata: { remaining: recovery.remaining },
          ...auditContext(ctx),
        });
      }
      return { user, method };
    },

    /**
     * Confirms the authenticator the create-super-admin command issued, with a first code.
     * Returns the recovery codes, which are shown once. It never issues a new secret, so a
     * password alone cannot enroll someone else's authenticator.
     */
    async confirmSetup(userId: string, code: string, ctx: RequestContext): Promise<string[]> {
      const at = now();
      const user = await users.findById(userId);
      if (!user || user.disabledAt || user.systemRole !== 'SUPER_ADMIN' || !user.mfaSecret) {
        throw AppError.forbidden('There is no authenticator to set up for this account');
      }
      if (user.mfaEnabledAt) {
        throw new AppError(409, ErrorCode.CONFLICT, 'Your authenticator is already set up');
      }
      await ensureNotLockedOut(user.id, ctx);
      if (!(await checkTotp(user, code, at))) {
        await audit.record({
          action: 'mfa_failed',
          actorId: user.id,
          entityType: 'user',
          entityId: user.id,
          metadata: { stage: 'setup', method: 'totp' },
          ...auditContext(ctx),
        });
        await countFailure(user, ctx, 'setup');
        throw invalidCode();
      }

      const { codes, hashes } = await issueRecoveryCodes();
      await users.enableMfa(user.id, hashes, at);
      await audit.record({
        action: 'mfa_enroll',
        actorId: user.id,
        entityType: 'user',
        entityId: user.id,
        metadata: { recoveryCodes: codes.length },
        ...auditContext(ctx),
      });
      return codes;
    },

    /** A fresh TOTP code unlocks destructive /system actions for this session, 5 minutes. */
    async stepUp(
      userId: string,
      sessionId: string,
      code: string,
      ctx: RequestContext,
    ): Promise<{ stepUpExpiresAt: string }> {
      const at = now();
      const user = await users.findById(userId);
      if (!user || user.disabledAt || !user.mfaEnabledAt) throw sessionEnded();
      await ensureNotLockedOut(user.id, ctx);
      if (!(await checkTotp(user, code, at))) {
        await audit.record({
          action: 'mfa_failed',
          actorId: user.id,
          entityType: 'user',
          entityId: user.id,
          metadata: { stage: 'step_up', method: 'totp' },
          ...auditContext(ctx),
        });
        await countFailure(user, ctx, 'step_up');
        throw invalidCode();
      }
      await store.setStepUp(sessionId, at);
      await audit.record({
        action: 'step_up',
        actorId: user.id,
        entityType: 'user',
        entityId: user.id,
        ...auditContext(ctx),
      });
      return { stepUpExpiresAt: new Date(at.getTime() + STEP_UP_TTL_SECONDS * 1000).toISOString() };
    },

    /** 403 STEP_UP_REQUIRED unless this session passed a step-up in the last 5 minutes. */
    async requireStepUp(sessionId: string): Promise<void> {
      const state = await store.getSession(sessionId);
      const fresh =
        state?.stepUpAt && now().getTime() - state.stepUpAt.getTime() <= STEP_UP_TTL_SECONDS * 1000;
      if (!fresh) {
        throw new AppError(
          403,
          ErrorCode.STEP_UP_REQUIRED,
          'Enter a code from your authenticator app to confirm this action',
        );
      }
    },

    /** Replaces every recovery code; the old ones stop working. Shown once. */
    async regenerateRecoveryCodes(userId: string, ctx: RequestContext): Promise<string[]> {
      const { codes, hashes } = await issueRecoveryCodes();
      await recoveryCodes.replaceAll(userId, hashes);
      await audit.record({
        action: 'recovery_codes_regenerate',
        actorId: userId,
        entityType: 'user',
        entityId: userId,
        metadata: { recoveryCodes: codes.length },
        ...auditContext(ctx),
      });
      return codes;
    },

    startSession,

    /**
     * Every authenticated request and refresh of a super admin session. Ends the session
     * (and revokes its refresh tokens) after 15 minutes without activity or 8 hours in
     * total. Background requests (polling) are checked but do not count as activity.
     */
    async checkSession(sessionId: string, { background }: { background: boolean }) {
      const at = now();
      const state = await store.getSession(sessionId);
      const ended =
        !state ||
        at.getTime() - state.lastSeenAt.getTime() > SUPER_ADMIN_IDLE_TIMEOUT_SECONDS * 1000 ||
        at.getTime() - state.startedAt.getTime() > SUPER_ADMIN_SESSION_MAX_SECONDS * 1000;
      if (ended) {
        await store.endSession(sessionId);
        await deps.refreshTokens.revokeFamily(sessionId, at);
        throw sessionEnded();
      }
      if (!background) await store.touchSession(sessionId, at);
    },

    async endSession(sessionId: string): Promise<void> {
      await store.endSession(sessionId);
    },

    /** GET /system/me/security */
    async security(userId: string, sessionId: string): Promise<SystemSecurity> {
      const at = now();
      const [user, state, remaining] = await Promise.all([
        users.findById(userId),
        store.getSession(sessionId),
        recoveryCodes.countUnused(userId),
      ]);
      if (!user?.mfaEnabledAt || !state) throw sessionEnded();
      const stepUpUntil = state.stepUpAt
        ? state.stepUpAt.getTime() + STEP_UP_TTL_SECONDS * 1000
        : null;
      return {
        mfaEnabledAt: user.mfaEnabledAt.toISOString(),
        recoveryCodesRemaining: remaining,
        sessionStartedAt: state.startedAt.toISOString(),
        sessionExpiresAt: new Date(
          state.startedAt.getTime() + SUPER_ADMIN_SESSION_MAX_SECONDS * 1000,
        ).toISOString(),
        idleTimeoutSeconds: SUPER_ADMIN_IDLE_TIMEOUT_SECONDS,
        stepUpExpiresAt:
          stepUpUntil && stepUpUntil > at.getTime() ? new Date(stepUpUntil).toISOString() : null,
      };
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

export type SuperAdminService = ReturnType<typeof createSuperAdminService>;
