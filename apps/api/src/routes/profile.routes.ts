import express, { Router, type RequestHandler } from 'express';
import { COVER_MAX_BYTES, LOGO_MAX_BYTES, LOGO_MIME_TYPES } from '@orghive/shared';
import { createProfileController } from '#src/controllers/profile.controller';
import { viewerCache } from '#src/middleware/public-cache';
import { createOrgGuards, optionalAuth, requireAuth } from '#src/middleware/require-auth';
import type { AccessService } from '#src/services/access.service';
import type { ConstitutionService } from '#src/services/constitution.service';
import type { ProfileService } from '#src/services/profile.service';
import type { TokenService } from '#src/services/token.service';

export interface ProfileRouterDeps {
  profiles: ProfileService;
  constitutions: ConstitutionService;
  access: AccessService;
  tokens: Pick<TokenService, 'verify'>;
}

const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
};

/**
 * The organization profile (/dashboard/profile) and its Constitution & By-laws. Only the
 * organization's own account reads the editable profile or changes anything
 * (requireOwnOrg); the constitution itself is a public read. The public profile is part of
 * GET /organizations/:slug.
 */
export function profileRouter({ profiles, constitutions, access, tokens }: ProfileRouterDeps): Router {
  const router = Router();
  const controller = createProfileController(profiles, constitutions);
  const { requireOwnOrg, requireActiveOrg } = createOrgGuards(access);
  const auth = requireAuth(tokens);
  const own = [auth, requireOwnOrg, noStore];

  router.get('/organizations/:slug/profile', ...own, controller.get);
  router.put('/organizations/:slug/profile', ...own, controller.save);
  // Small images only, as raw bytes; never through Multer or the JSON parser.
  router.put(
    '/organizations/:slug/profile/logo',
    ...own,
    express.raw({ type: [...LOGO_MIME_TYPES], limit: LOGO_MAX_BYTES }),
    controller.setLogo,
  );
  router.put(
    '/organizations/:slug/profile/cover',
    ...own,
    express.raw({ type: [...LOGO_MIME_TYPES], limit: COVER_MAX_BYTES }),
    controller.setCover,
  );
  router.delete('/organizations/:slug/profile/cover', ...own, controller.removeCover);

  router.get(
    '/organizations/:slug/constitution',
    optionalAuth(tokens),
    viewerCache,
    controller.getConstitution,
  );
  // A deactivated organization cannot upload (docs/DOMAIN_RULES.md, "Administration").
  router.post(
    '/organizations/:slug/constitution',
    auth,
    requireOwnOrg,
    requireActiveOrg,
    controller.uploadConstitution,
  );

  return router;
}
