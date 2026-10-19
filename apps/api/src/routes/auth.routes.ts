import { Router } from 'express';
import { createAuthController } from '#src/controllers/auth.controller';
import { authRateLimits, type RateLimitStoreFactory } from '#src/middleware/rate-limit';
import { requireAuth, type AccessVerifier } from '#src/middleware/require-auth';
import { requireSameOrigin } from '#src/middleware/same-origin';
import type { AuthService } from '#src/services/auth.service';

export interface AuthRouterDeps {
  auth: AuthService;
  tokens: AccessVerifier;
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
  /** /me answers during MFA setup too, so the app can show the setup screen. */
  const anySession = requireAuth(tokens, { allowPasswordChange: true, allowMfaSetup: true });
  const mfaSetup = requireAuth(tokens, { allowMfaSetup: true });

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.post('/login', limits.login, controller.login);
  // Super admins: the code step (TOTP or recovery code), and the first authenticator check.
  // Both also count toward the super admin lockout (5 failures in 15 minutes).
  router.post('/mfa/verify', limits.passwordChecks, controller.verifyMfa);
  router.post('/mfa/setup', limits.passwordChecks, mfaSetup, controller.confirmMfaSetup);
  router.post('/refresh', limits.refresh, sameOrigin, controller.refresh);
  router.post('/logout', sameOrigin, controller.logout);
  router.post('/forgot-password', limits.forgotPassword, controller.forgotPassword);
  router.post('/reset-password', limits.passwordChecks, controller.resetPassword);
  router.post('/change-password', limits.passwordChecks, signedIn, controller.changePassword);
  router.get('/me', anySession, controller.me);

  return router;
}
