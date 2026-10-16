import { Router } from 'express';
import { createOrganizationController } from '#src/controllers/organization.controller';
import { publicCache } from '#src/middleware/public-cache';
import type { OrganizationService } from '#src/services/organization.service';

/** Public reads. Mutating routes added here later need requireAuth + requireOrgRole. */
export function organizationsRouter(organizations: OrganizationService): Router {
  const router = Router();
  const controller = createOrganizationController(organizations);

  router.get('/:slug', publicCache, controller.getBySlug);

  return router;
}
