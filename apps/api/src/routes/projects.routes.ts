import { Router } from 'express';
import { createProjectController } from '#src/controllers/project.controller';
import { createOrgGuards, requireAuth } from '#src/middleware/require-auth';
import type { AccessService } from '#src/services/access.service';
import type { FinancialFiguresService } from '#src/services/financial-figures.service';
import type { ProjectService } from '#src/services/project.service';
import type { TokenService } from '#src/services/token.service';

export interface ProjectsRouterDeps {
  projects: ProjectService;
  /** Corrections to a Financial Report's totals (spec 5D). */
  figures: Pick<FinancialFiguresService, 'correct'>;
  access: AccessService;
  tokens: Pick<TokenService, 'verify'>;
}

/**
 * Projects and their milestone checklist (docs/PROJECT_WORKFLOW_SPEC.md, 2A and 2B). The
 * organization's account and its governing bodies read them; only its own account creates,
 * edits and files tasks. A task's file then follows the document visibility rules like any
 * other Paperworks file.
 */
export function projectsRouter({ projects, figures, access, tokens }: ProjectsRouterDeps): Router {
  const router = Router();
  const controller = createProjectController(projects, figures);
  const { requireOwnOrg, requireOrgOrGoverning, requireActiveOrg } = createOrgGuards(access);
  const auth = requireAuth(tokens);

  router.get('/organizations/:slug/projects', auth, requireOrgOrGoverning, controller.list);
  // A deactivated organization cannot start projects or file their documents.
  router.post(
    '/organizations/:slug/projects',
    auth,
    requireOwnOrg,
    requireActiveOrg,
    controller.create,
  );
  router.get('/projects/:projectId', auth, requireOrgOrGoverning, controller.get);
  router.patch('/projects/:projectId', auth, requireOwnOrg, controller.update);
  router.post(
    '/projects/:projectId/tasks/:type/upload-url',
    auth,
    requireOwnOrg,
    requireActiveOrg,
    controller.taskUploadUrl,
  );
  router.post(
    '/projects/:projectId/tasks/:type/documents',
    auth,
    requireOwnOrg,
    requireActiveOrg,
    controller.submitTaskFile,
  );
  // Extra files outside the checklist (spec 2C): any phase, whatever the checklist's state.
  router.post(
    '/projects/:projectId/files/upload-url',
    auth,
    requireOwnOrg,
    requireActiveOrg,
    controller.fileUploadUrl,
  );
  router.post('/projects/:projectId/files', auth, requireOwnOrg, requireActiveOrg, controller.addFile);
  router.patch(
    '/projects/:projectId/financial-figures',
    auth,
    requireOwnOrg,
    requireActiveOrg,
    controller.correctFigures,
  );

  return router;
}
