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
 * members see its blocks, freezes and appeals; only its own officers appeal (admins do not
 * pass: an appeal is the organization's own decision). Deciding is checked in the service
 * against appeal-rules.ts, since the decider belongs to another organization.
 */
export function appealsRouter({ appeals, access, tokens }: AppealsRouterDeps): Router {
  const router = Router();
  const controller = createAppealController(appeals);
  const { requireOrgRole, requireOwnOrgRole } = createOrgGuards(access);
  const auth = requireAuth(tokens);
  const member = requireOrgRole('officer', 'adviser');
  const ownOfficer = requireOwnOrgRole('officer');

  router.get('/organizations/:slug/compliance', auth, member, controller.compliance);
  router.post('/organizations/:slug/appeals', auth, ownOfficer, controller.submit);
  router.post(
    '/organizations/:slug/appeal-attachments/upload-url',
    auth,
    ownOfficer,
    controller.attachmentUploadUrl,
  );
  router.post(
    '/organizations/:slug/appeal-attachments',
    auth,
    ownOfficer,
    controller.addAttachment,
  );
  router.get(
    '/organizations/:slug/appeal-attachments/:attachmentId',
    auth,
    ownOfficer,
    controller.getAttachment,
  );
  router.get('/projects/:projectId/appeals', auth, member, controller.listForProject);

  router.get('/appeals/queue', auth, controller.queue);
  router.post('/appeals/:appealId/decision', auth, controller.decide);
  router.get(
    '/appeals/:appealId/attachments/:attachmentId/download',
    auth,
    controller.downloadAttachment,
  );

  return router;
}
