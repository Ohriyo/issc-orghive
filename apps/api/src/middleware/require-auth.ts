import type { Request, RequestHandler, Response } from 'express';
import { ErrorCode, type MembershipRole } from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import type { AccessClaims, TokenService } from '#src/services/token.service';

const AUTH_KEY = 'auth';

/** The verified claims `requireAuth` attached. Throws if a route forgot to use it. */
export function authOf(res: Response): AccessClaims {
  const claims = (res.locals as Record<string, unknown>)[AUTH_KEY];
  if (!claims) throw new Error('authOf() called on a route without requireAuth');
  return claims as AccessClaims;
}

export interface RequireAuthOptions {
  /**
   * Accept a token issued with a temporary password. Only the change-password route
   * (and /me, so the app can show who is signed in) sets this.
   */
  allowPasswordChange?: boolean;
}

/** Verifies `Authorization: Bearer <access token>`. */
export function requireAuth(
  tokens: Pick<TokenService, 'verify'>,
  { allowPasswordChange = false }: RequireAuthOptions = {},
): RequestHandler {
  return async (req, res, next) => {
    const header = req.get('authorization');
    const match = header?.match(/^Bearer ([A-Za-z0-9_.-]+)$/);
    if (!match) throw AppError.unauthorized();

    const claims = await tokens.verify(match[1]!);
    if (claims.passwordChangeRequired && !allowPasswordChange) {
      throw new AppError(
        403,
        ErrorCode.PASSWORD_CHANGE_REQUIRED,
        'Change your temporary password before continuing',
      );
    }
    (res.locals as Record<string, unknown>)[AUTH_KEY] = claims;
    next();
  };
}

/**
 * Allows the request when the user holds `role` in the target organization, or is an
 * ISSC admin. Use after `requireAuth` on every mutating route (CLAUDE.md).
 */
export function requireOrgRole(
  role: MembershipRole,
  orgIdOf: (req: Request) => string | undefined,
): RequestHandler {
  return (req, res, next) => {
    const claims = authOf(res);
    const orgId = orgIdOf(req);
    const allowed =
      claims.isAdmin || (!!orgId && claims.roles.some((r) => r.orgId === orgId && r.role === role));
    if (!allowed) throw AppError.forbidden();
    next();
  };
}
