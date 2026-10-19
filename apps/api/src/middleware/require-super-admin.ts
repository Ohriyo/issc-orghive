import { BACKGROUND_REQUEST_HEADER } from '@orghive/shared';
import type { Request, RequestHandler } from 'express';
import { AppError } from '#src/errors/app-error';
import type { RequestContext } from '#src/services/auth.service';
import type { SuperAdminService } from '#src/services/super-admin.service';
import type { SystemService } from '#src/services/system.service';
import { authOf } from './require-auth';

export function requestContext(req: Request): RequestContext {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}

/** The super admin session id `requireSuperAdmin` checked. Throws if a route forgot it. */
export function superAdminSessionOf(claims: { sessionId?: string }): string {
  if (!claims.sessionId) throw new Error('A super admin route without a session id');
  return claims.sessionId;
}

/**
 * Active SUPER_ADMIN only (after `requireAuth`): the token must say so, and the database
 * must agree (not disabled, still SUPER_ADMIN, authenticator confirmed), so a demotion or
 * deactivation takes effect on the next request, not when the token expires.
 */
export function requireSuperAdmin(system: Pick<SystemService, 'assertSuperAdmin'>): RequestHandler {
  return async (_req, res, next) => {
    const claims = authOf(res);
    if (claims.systemRole !== 'SUPER_ADMIN' || !claims.sessionId) {
      throw AppError.forbidden('Only super admins can open the system console');
    }
    await system.assertSuperAdmin(claims.userId);
    next();
  };
}

/** Destructive actions: a step-up code from the last 5 minutes (403 STEP_UP_REQUIRED). */
export function requireStepUp(
  superAdmins: Pick<SuperAdminService, 'requireStepUp'>,
): RequestHandler {
  return async (_req, res, next) => {
    await superAdmins.requireStepUp(superAdminSessionOf(authOf(res)));
    next();
  };
}

/**
 * Audits every /system read (`system_view`). Writes are audited by their service, with
 * before and after values, so they are skipped here; so are background polls (the sidebar's
 * request count), which nobody reads as a page.
 */
export function auditSystemReads(system: Pick<SystemService, 'recordView'>): RequestHandler {
  return async (req, res, next) => {
    if (req.method === 'GET' && req.get(BACKGROUND_REQUEST_HEADER) !== '1') {
      // The route pattern is not known yet at router level; the path never holds secrets.
      await system.recordView(authOf(res).userId, `${req.baseUrl}${req.path}`, requestContext(req));
    }
    next();
  };
}
