import { Router, type RequestHandler } from 'express';
import { complianceOverviewQuerySchema } from '@orghive/shared';
import { authOf, requireAuth } from '#src/middleware/require-auth';
import type { ComplianceOverviewService } from '#src/services/compliance-overview.service';
import type { TokenService } from '#src/services/token.service';

export interface ComplianceOverviewRouterDeps {
  overview: ComplianceOverviewService;
  tokens: Pick<TokenService, 'verify'>;
}

/**
 * GET /compliance/overview: read-only, for the CSCs and the ISSC. The service decides the
 * scope from the user's memberships (403 for everyone else). Never cached: it is per user.
 */
export function complianceOverviewRouter({
  overview,
  tokens,
}: ComplianceOverviewRouterDeps): Router {
  const router = Router();
  const get: RequestHandler = async (req, res) => {
    const query = complianceOverviewQuerySchema.parse(req.query);
    res.set('Cache-Control', 'private, no-store');
    res.json(await overview.get(authOf(res).userId, query));
  };
  router.get('/compliance/overview', requireAuth(tokens), get);
  return router;
}
