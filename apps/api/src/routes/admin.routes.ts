import express, { Router, type RequestHandler } from 'express';
import { LOGO_MAX_BYTES, LOGO_MIME_TYPES } from '@orghive/shared';
import { createAdminController } from '#src/controllers/admin.controller';
import { createFinancialFiguresController } from '#src/controllers/financial-figures.controller';
import { createHandbookController } from '#src/controllers/handbook.controller';
import { createLeaderboardAdminController } from '#src/controllers/leaderboard-admin.controller';
import { createOrgGuards, requireAuth } from '#src/middleware/require-auth';
import type { AccessService } from '#src/services/access.service';
import type { AccountRequestService } from '#src/services/account-request.service';
import type { AdminOrganizationService } from '#src/services/admin-organization.service';
import type { DisqualificationService } from '#src/services/disqualification.service';
import type { FinancialFiguresService } from '#src/services/financial-figures.service';
import type { HandbookService } from '#src/services/handbook.service';
import type { SemesterCalendarService } from '#src/services/semester-calendar.service';
import type { TokenService } from '#src/services/token.service';

export interface AdminRouterDeps {
  organizations: AdminOrganizationService;
  /** The ISSC account's requests for organizations' accounts. */
  accountRequests: AccountRequestService;
  /** Reported Financial Report figures, which the ISSC can put under review (spec 5D). */
  figures: Pick<FinancialFiguresService, 'list' | 'flag' | 'clearFlag'>;
  /** The Student Handbook: uploads and the current edition (the ISSC account). */
  handbook: HandbookService;
  /** The dates of each semester, which the ISSC account sets (spec 5B). */
  semesters: Pick<SemesterCalendarService, 'adminList' | 'set'>;
  /** Disqualifications from a semester's leaderboard (spec 5B). */
  disqualifications: DisqualificationService;
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
  figures,
  handbook,
  semesters,
  disqualifications,
  access,
  tokens,
}: AdminRouterDeps): Router {
  const router = Router();
  const controller = createAdminController(organizations, accountRequests);
  const figuresController = createFinancialFiguresController(figures);
  const handbookController = createHandbookController(handbook);
  const leaderboardAdmin = createLeaderboardAdminController(semesters, disqualifications);
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
  router.get('/handbook', handbookController.adminList);
  router.post('/handbook', handbookController.upload);
  router.put('/handbook/:year/current', handbookController.makeCurrent);
  router.post('/handbook/:year/preview/retry', handbookController.retryPreview);
  router.get('/semesters', leaderboardAdmin.listSemesters);
  router.put('/semesters/:academicYear/:semester', leaderboardAdmin.setSemester);
  router.get('/disqualifications', leaderboardAdmin.listDisqualifications);
  router.post('/disqualifications', leaderboardAdmin.disqualify);
  router.post('/disqualifications/:id/lift', leaderboardAdmin.lift);
  router.get('/financial-figures', figuresController.list);
  router.put('/projects/:projectId/financial-figures/flag', figuresController.flag);
  router.delete('/projects/:projectId/financial-figures/flag', figuresController.clearFlag);

  return router;
}
