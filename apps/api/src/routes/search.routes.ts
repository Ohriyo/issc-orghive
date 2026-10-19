import { Router } from 'express';
import { createSearchController } from '#src/controllers/search.controller';
import { viewerCache } from '#src/middleware/public-cache';
import { optionalAuth } from '#src/middleware/require-auth';
import type { SearchService } from '#src/services/search.service';
import type { TokenService } from '#src/services/token.service';

export interface SearchRouterDeps {
  search: SearchService;
  tokens: Pick<TokenService, 'verify'>;
}

/**
 * GET /search: public, filtered by the repository for whoever is asking. Signed-out
 * responses are publicly cacheable; anything sent with a token is `private, no-store`.
 */
export function searchRouter({ search, tokens }: SearchRouterDeps): Router {
  const router = Router();
  const controller = createSearchController(search);
  router.get('/', optionalAuth(tokens), viewerCache, controller.find);
  return router;
}
