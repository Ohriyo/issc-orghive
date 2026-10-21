import express, { Router } from 'express';
import { LOGO_MAX_BYTES, LOGO_MIME_TYPES } from '@orghive/shared';
import { createAccountAdminController } from '#src/controllers/account-admin.controller';
import { createSystemController } from '#src/controllers/system.controller';
import { requireAuth, type AccessVerifier } from '#src/middleware/require-auth';
import {
  auditSystemReads,
  requireStepUp,
  requireSuperAdmin,
} from '#src/middleware/require-super-admin';
import type { AccountAdminService } from '#src/services/account-admin.service';
import type { AccountImportService } from '#src/services/account-import.service';
import type { AccountRequestService } from '#src/services/account-request.service';
import type { AdminOrganizationService } from '#src/services/admin-organization.service';
import type { SuperAdminService } from '#src/services/super-admin.service';
import type { SupportService } from '#src/services/support.service';
import type { SystemService } from '#src/services/system.service';
import type { SystemSettingsService } from '#src/services/system-settings.service';

export interface SystemRouterDeps {
  system: SystemService;
  superAdmins: SuperAdminService;
  accounts: AccountAdminService;
  organizations: Pick<AdminOrganizationService, 'tree' | 'setLogo'>;
  support: SupportService;
  requests: AccountRequestService;
  imports: AccountImportService;
  /** System settings, such as the leaderboard's late value (spec 5C). */
  settings: Pick<SystemSettingsService, 'get' | 'update'>;
  tokens: AccessVerifier;
}

/**
 * /api/v1/system: the super admin console. Every route: a signed-in, active SUPER_ADMIN
 * with MFA (checked in the database each time), audited. Destructive ones also need a
 * step-up code from the last 5 minutes.
 */
export function systemRouter({
  system,
  superAdmins,
  accounts,
  organizations,
  support,
  requests,
  imports,
  settings,
  tokens,
}: SystemRouterDeps): Router {
  const router = Router();
  const controller = createSystemController(system, superAdmins, settings);
  const consoleController = createAccountAdminController(
    accounts,
    organizations,
    support,
    requests,
    imports,
  );
  const stepUp = requireStepUp(superAdmins);

  router.use(requireAuth(tokens), requireSuperAdmin(system), auditSystemReads(system));
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });

  router.get('/overview', controller.overview);
  router.get('/users', consoleController.list);
  router.get('/users/:userId', consoleController.detail);
  router.patch('/users/:userId', consoleController.update);
  router.post('/users/:userId/password-reset', stepUp, consoleController.resetPassword);
  router.post('/users/:userId/sign-out', stepUp, consoleController.signOut);
  router.patch('/users/:userId/lock', consoleController.setLock);
  router.patch('/users/:userId/status', stepUp, controller.setUserStatus);
  router.patch('/users/:userId/system-role', stepUp, controller.setSystemRole);
  router.post('/accounts', consoleController.create);
  // CSV imports: a preview changes nothing; the end of term needs a fresh step-up code.
  router.post('/accounts/bulk/preview', consoleController.previewBulk);
  router.post('/accounts/bulk', consoleController.bulkCreate);
  router.post('/end-of-term/preview', consoleController.previewEndOfTerm);
  router.post('/end-of-term', stepUp, consoleController.endOfTerm);
  router.get('/account-requests', consoleController.listRequests);
  router.get('/account-requests/count', consoleController.countRequests);
  router.get('/account-requests/:requestId', consoleController.getRequest);
  router.post('/account-requests/:requestId/decline', consoleController.declineRequest);
  router.get('/organizations', consoleController.organizationTree);
  // Small images only, as raw bytes, like /admin's logo upload.
  router.put(
    '/organizations/:slug/logo',
    express.raw({ type: [...LOGO_MIME_TYPES], limit: LOGO_MAX_BYTES }),
    consoleController.setLogo,
  );
  router.get('/organizations/:slug/documents', consoleController.supportDocuments);
  router.post('/documents/:documentId/rescan', consoleController.rescan);
  router.post('/documents/:documentId/restore', consoleController.restore);
  router.get('/test-data', consoleController.testData);
  router.post('/test-data/delete', stepUp, consoleController.deleteTestData);
  router.get('/settings', controller.getSettings);
  router.patch('/settings', controller.updateSettings);
  router.get('/audit-logs', controller.listAuditLogs);
  router.get('/me/security', controller.security);
  router.post('/me/recovery-codes', stepUp, controller.regenerateRecoveryCodes);
  router.post('/step-up', controller.stepUp);

  return router;
}
