import { Router } from 'express';
import { createOrgShowcaseController } from '#src/controllers/org-showcase.controller';
import { publicCache } from '#src/middleware/public-cache';
import type { OrgShowcaseService } from '#src/services/org-showcase.service';

/**
 * The organization page's rank badge, completed projects and public documents
 * (docs/DOMAIN_RULES.md, "Organization page"). Public: only what anyone may see.
 */
export function orgShowcaseRouter({ showcase }: { showcase: OrgShowcaseService }): Router {
  const router = Router();
  const controller = createOrgShowcaseController(showcase);
  router.get('/organizations/:slug/showcase', publicCache, controller.read);
  return router;
}
