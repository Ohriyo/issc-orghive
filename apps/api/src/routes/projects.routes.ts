import { Router } from 'express';
import { createProjectController } from '#src/controllers/project.controller';
import { createOrgGuards, requireAuth } from '#src/middleware/require-auth';
import type { AccessService } from '#src/services/access.service';
import type { ProjectService } from '#src/services/project.service';
import type { TokenService } from '#src/services/token.service';

export interface ProjectsRouterDeps {
  projects: ProjectService;
  access: AccessService;
  tokens: Pick<TokenService, 'verify'>;
}

/**
 * Projects and their milestone checklist (docs/PROJECT_WORKFLOW_SPEC.md, 2A and 2B). The
 * organization's members read them; its officers create, edit and file tasks. A task's
 * file then follows the document visibility rules like any other Paperworks file.
 */
export function projectsRouter({ projects, access, tokens }: ProjectsRouterDeps): Router {
  const router = Router();
  const controller = createProjectController(projects);
  const { requireOrgRole } = createOrgGuards(access);
  const auth = requireAuth(tokens);
  const member = requireOrgRole('officer', 'adviser');
  const officer = requireOrgRole('officer');

  router.get('/organizations/:slug/projects', auth, member, controller.list);
  router.post('/organizations/:slug/projects', auth, officer, controller.create);
  router.get('/projects/:projectId', auth, member, controller.get);
  router.patch('/projects/:projectId', auth, officer, controller.update);
  router.post(
    '/projects/:projectId/tasks/:type/upload-url',
    auth,
    officer,
    controller.taskUploadUrl,
  );
  router.post(
    '/projects/:projectId/tasks/:type/documents',
    auth,
    officer,
    controller.submitTaskFile,
  );

  return router;
}
