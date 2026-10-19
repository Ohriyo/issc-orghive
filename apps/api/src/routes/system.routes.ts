import { Router } from 'express';
import { createSystemController } from '#src/controllers/system.controller';
import { requireAuth, type AccessVerifier } from '#src/middleware/require-auth';
import {
  auditSystemReads,
  requireStepUp,
  requireSuperAdmin,
} from '#src/middleware/require-super-admin';
import type { SuperAdminService } from '#src/services/super-admin.service';
import type { SystemService } from '#src/services/system.service';

export interface SystemRouterDeps {
  system: SystemService;
  superAdmins: SuperAdminService;
  tokens: AccessVerifier;
}

/**
 * /api/v1/system: the super admin console. Every route: a signed-in, active SUPER_ADMIN
 * with MFA (checked in the database each time), audited. Destructive ones also need a
 * step-up code from the last 5 minutes.
 */
export function systemRouter({ system, superAdmins, tokens }: SystemRouterDeps): Router {
  const router = Router();
  const controller = createSystemController(system, superAdmins);
  const stepUp = requireStepUp(superAdmins);

  router.use(requireAuth(tokens), requireSuperAdmin(system), auditSystemReads(system));
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });

  router.get('/overview', controller.overview);
  router.get('/users', controller.listUsers);
  router.patch('/users/:userId/status', stepUp, controller.setUserStatus);
  router.patch('/users/:userId/system-role', stepUp, controller.setSystemRole);
  router.get('/audit-logs', controller.listAuditLogs);
  router.get('/me/security', controller.security);
  router.post('/me/recovery-codes', stepUp, controller.regenerateRecoveryCodes);
  router.post('/step-up', controller.stepUp);

  return router;
}
