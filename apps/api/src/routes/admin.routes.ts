import express, { Router, type RequestHandler } from 'express';
import { LOGO_MAX_BYTES, LOGO_MIME_TYPES } from '@orghive/shared';
import { createAdminController } from '#src/controllers/admin.controller';
import { createOrgGuards, requireAuth } from '#src/middleware/require-auth';
import type { AccessService } from '#src/services/access.service';
import type { AccountRequestService } from '#src/services/account-request.service';
import type { AdminOrganizationService } from '#src/services/admin-organization.service';
import type { TokenService } from '#src/services/token.service';

export interface AdminRouterDeps {
  organizations: AdminOrganizationService;
  /** The ISSC account's requests for organizations' accounts. */
  accountRequests: AccountRequestService;
  access: AccessService;
  tokens: Pick<TokenService, 'verify'>;
}

const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
};

/**
 * /admin: ISSC admins only (docs/DOMAIN_RULES.md, "Administration"). Every route needs a
 * signed-in, active ISSC admin, checked against the database on each request.
 */
export function adminRouter({
  organizations,
  accountRequests,
  access,
  tokens,
}: AdminRouterDeps): Router {
  const router = Router();
  const controller = createAdminController(organizations, accountRequests);
  const { requireAdmin } = createOrgGuards(access);
  router.use(requireAuth(tokens), requireAdmin, noStore);

  router.get('/organizations', controller.tree);
  router.post('/colleges', controller.createCollege);
  router.put('/colleges/order', controller.reorderColleges);
  router.patch('/colleges/:slug', controller.updateCollege);
  router.put('/colleges/:slug/organizations/order', controller.reorderSbos);
  router.post('/organizations', controller.createOrganization);
  router.patch('/organizations/:slug', controller.updateOrganization);
  router.put('/organizations/:slug/active', controller.setActive);
  router.post('/organizations/:slug/account-request', controller.requestAccount);
  // Small images only, as raw bytes; never through Multer or the JSON parser.
  router.put(
    '/organizations/:slug/logo',
    express.raw({ type: [...LOGO_MIME_TYPES], limit: LOGO_MAX_BYTES }),
    controller.setLogo,
  );

  return router;
}
