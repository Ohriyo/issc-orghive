import { Router } from 'express';
import { createAuthController } from '#src/controllers/auth.controller';
import { authRateLimits, type RateLimitStoreFactory } from '#src/middleware/rate-limit';
import { requireAuth } from '#src/middleware/require-auth';
import { requireSameOrigin } from '#src/middleware/same-origin';
import type { AuthService } from '#src/services/auth.service';
import type { TokenService } from '#src/services/token.service';

export interface AuthRouterDeps {
  auth: AuthService;
  tokens: Pick<TokenService, 'verify'>;
  webOrigin: string;
  rateLimitStore?: RateLimitStoreFactory;
}

/** /api/v1/auth. Every response is private and never cached. */
export function authRouter({ auth, tokens, webOrigin, rateLimitStore }: AuthRouterDeps): Router {
  const router = Router();
  const controller = createAuthController(auth);
  const limits = authRateLimits(rateLimitStore);
  const sameOrigin = requireSameOrigin(webOrigin);
  const signedIn = requireAuth(tokens, { allowPasswordChange: true });

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.post('/login', limits.login, controller.login);
  router.post('/refresh', limits.refresh, sameOrigin, controller.refresh);
  router.post('/logout', sameOrigin, controller.logout);
  router.post('/forgot-password', limits.forgotPassword, controller.forgotPassword);
  router.post('/reset-password', limits.passwordChecks, controller.resetPassword);
  router.post('/change-password', limits.passwordChecks, signedIn, controller.changePassword);
  router.get('/me', signedIn, controller.me);

  return router;
}
