import { AppError } from '#src/errors/app-error';
import type { AccountRepository } from '#src/repositories/account.repository';
import type { SuperAdminService } from '#src/services/super-admin.service';
import type { AccessClaims } from '#src/services/token.service';

export interface SessionGuardDeps {
  accounts: Pick<AccountRepository, 'sessionsRevokedAt'>;
  superAdmins: Pick<SuperAdminService, 'checkSession'>;
}

/**
 * The `checkSession` every route's requireAuth runs. Refusing a token issued before the
 * account's sessions were ended makes a reset, a forced sign-out, a lock or a deactivation
 * take effect at once, not when the 15-minute access token expires. Both times are real
 * clock milliseconds, so a sign-in right after a reset works.
 */
export function createSessionGuard({ accounts, superAdmins }: SessionGuardDeps) {
  return async (claims: AccessClaims, activity: { background: boolean }): Promise<void> => {
    const revokedAt = await accounts.sessionsRevokedAt(claims.userId);
    if (revokedAt && claims.issuedAtMs !== undefined && claims.issuedAtMs < revokedAt.getTime()) {
      throw AppError.unauthorized('Your session was ended. Sign in again.');
    }
    if (claims.sessionId) await superAdmins.checkSession(claims.sessionId, activity);
  };
}
