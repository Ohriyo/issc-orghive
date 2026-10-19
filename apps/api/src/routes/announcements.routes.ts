import { Router } from 'express';
import { createAnnouncementController } from '#src/controllers/announcement.controller';
import { viewerCache } from '#src/middleware/public-cache';
import { createOrgGuards, optionalAuth, requireAuth } from '#src/middleware/require-auth';
import type { AccessService } from '#src/services/access.service';
import type { AnnouncementService } from '#src/services/announcement.service';
import type { TokenService } from '#src/services/token.service';

export interface AnnouncementsRouterDeps {
  announcements: AnnouncementService;
  access: AccessService;
  tokens: Pick<TokenService, 'verify'>;
}

/**
 * Updates (docs/DOMAIN_RULES.md): anyone reads; the posting council's own account writes.
 * An update speaks for its council, so nobody else passes.
 */
export function announcementsRouter({
  announcements,
  access,
  tokens,
}: AnnouncementsRouterDeps): Router {
  const router = Router();
  const controller = createAnnouncementController(announcements);
  const { requireOwnOrg } = createOrgGuards(access);
  const auth = requireAuth(tokens);

  router.get('/announcements', optionalAuth(tokens), viewerCache, controller.list);
  router.get('/announcements/:announcementId', optionalAuth(tokens), viewerCache, controller.get);
  router.post('/organizations/:slug/announcements', auth, requireOwnOrg, controller.create);
  router.patch('/announcements/:announcementId', auth, requireOwnOrg, controller.update);
  router.delete('/announcements/:announcementId', auth, requireOwnOrg, controller.remove);

  return router;
}
