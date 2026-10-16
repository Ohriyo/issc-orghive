import { Router } from 'express';
import { createDashboardController } from '#src/controllers/dashboard.controller';
import { requireAuth } from '#src/middleware/require-auth';
import type { DashboardService } from '#src/services/dashboard.service';
import type { TokenService } from '#src/services/token.service';

export interface MeRouterDeps {
  dashboard: DashboardService;
  tokens: Pick<TokenService, 'verify'>;
}

/** The signed-in user's own data. Everything here needs a session. */
export function meRouter({ dashboard, tokens }: MeRouterDeps): Router {
  const router = Router();
  const controller = createDashboardController(dashboard);

  router.get('/dashboard', requireAuth(tokens), controller.get);

  return router;
}
