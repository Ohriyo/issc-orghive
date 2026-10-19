import type { RequestHandler } from 'express';
import {
  setSystemRoleRequestSchema,
  setUserStatusRequestSchema,
  stepUpRequestSchema,
  systemAuditQuerySchema,
  systemUserIdParamsSchema,
  type RecoveryCodesResponse,
} from '@orghive/shared';
import { authOf } from '#src/middleware/require-auth';
import { requestContext, superAdminSessionOf } from '#src/middleware/require-super-admin';
import type { SuperAdminService } from '#src/services/super-admin.service';
import type { SystemService } from '#src/services/system.service';

export function createSystemController(system: SystemService, superAdmins: SuperAdminService) {
  const overview: RequestHandler = async (_req, res) => {
    res.json(await system.overview());
  };

  const setUserStatus: RequestHandler = async (req, res) => {
    const { userId } = systemUserIdParamsSchema.parse(req.params);
    const { active } = setUserStatusRequestSchema.parse(req.body);
    res.json(await system.setUserActive(authOf(res).userId, userId, active, requestContext(req)));
  };

  const setSystemRole: RequestHandler = async (req, res) => {
    const { userId } = systemUserIdParamsSchema.parse(req.params);
    setSystemRoleRequestSchema.parse(req.body);
    res.json(await system.demote(authOf(res).userId, userId, requestContext(req)));
  };

  const listAuditLogs: RequestHandler = async (req, res) => {
    res.json(await system.listAuditLogs(systemAuditQuerySchema.parse(req.query)));
  };

  const security: RequestHandler = async (_req, res) => {
    const claims = authOf(res);
    res.json(await superAdmins.security(claims.userId, superAdminSessionOf(claims)));
  };

  const stepUp: RequestHandler = async (req, res) => {
    const { code } = stepUpRequestSchema.parse(req.body);
    const claims = authOf(res);
    res.json(
      await superAdmins.stepUp(
        claims.userId,
        superAdminSessionOf(claims),
        code,
        requestContext(req),
      ),
    );
  };

  const regenerateRecoveryCodes: RequestHandler = async (req, res) => {
    const recoveryCodes = await superAdmins.regenerateRecoveryCodes(
      authOf(res).userId,
      requestContext(req),
    );
    res.json({ recoveryCodes } satisfies RecoveryCodesResponse);
  };

  return {
    overview,
    setUserStatus,
    setSystemRole,
    listAuditLogs,
    security,
    stepUp,
    regenerateRecoveryCodes,
  };
}
