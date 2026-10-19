import { Router } from 'express';
import { createAppealController } from '#src/controllers/appeal.controller';
import { createOrgGuards, requireAuth } from '#src/middleware/require-auth';
import type { AccessService } from '#src/services/access.service';
import type { AppealService } from '#src/services/appeal.service';
import type { TokenService } from '#src/services/token.service';

export interface AppealsRouterDeps {
  appeals: AppealService;
  access: AccessService;
  tokens: Pick<TokenService, 'verify'>;
}

/**
 * Compliance and appeals (docs/PROJECT_WORKFLOW_SPEC.md, section 3). An organization's
 * account and its governing bodies (its CSC, the ISSC) see its blocks, freezes and appeals;
 * only its own account appeals. Deciding is checked in the service against appeal-rules.ts,
 * since the deciding account belongs to another organization.
 */
export function appealsRouter({ appeals, access, tokens }: AppealsRouterDeps): Router {
  const router = Router();
  const controller = createAppealController(appeals);
  const { requireOwnOrg, requireOrgOrGoverning } = createOrgGuards(access);
  const auth = requireAuth(tokens);

  router.get('/organizations/:slug/compliance', auth, requireOrgOrGoverning, controller.compliance);
  router.post('/organizations/:slug/appeals', auth, requireOwnOrg, controller.submit);
  router.post(
    '/organizations/:slug/appeal-attachments/upload-url',
    auth,
    requireOwnOrg,
    controller.attachmentUploadUrl,
  );
  router.post(
    '/organizations/:slug/appeal-attachments',
    auth,
    requireOwnOrg,
    controller.addAttachment,
  );
  router.get(
    '/organizations/:slug/appeal-attachments/:attachmentId',
    auth,
    requireOwnOrg,
    controller.getAttachment,
  );
  router.get(
    '/projects/:projectId/appeals',
    auth,
    requireOrgOrGoverning,
    controller.listForProject,
  );

  router.get('/appeals/queue', auth, controller.queue);
  router.post('/appeals/:appealId/decision', auth, controller.decide);
  router.get(
    '/appeals/:appealId/attachments/:attachmentId/download',
    auth,
    controller.downloadAttachment,
  );

  return router;
}
