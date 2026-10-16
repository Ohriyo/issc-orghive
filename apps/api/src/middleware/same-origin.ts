import type { RequestHandler } from 'express';
import { AppError } from '#src/errors/app-error';

/**
 * For routes authenticated by the refresh cookie (refresh, logout): the request must come
 * from the web app's own origin. Defense in depth on top of SameSite=Strict, against CSRF
 * from sibling subdomains or browsers that do not enforce SameSite. Browsers always send
 * Origin on POST, so a missing header is refused too.
 */
export function requireSameOrigin(webOrigin: string): RequestHandler {
  const allowed = new URL(webOrigin).origin;
  return (req, _res, next) => {
    if (req.get('origin') !== allowed) throw AppError.forbidden('Cross-site request refused');
    next();
  };
}
