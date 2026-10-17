import { Router } from 'express';
import { createReportController } from '#src/controllers/report.controller';
import { createOrgGuards, requireAuth } from '#src/middleware/require-auth';
import type { AccessService } from '#src/services/access.service';
import type { ReportService } from '#src/services/report.service';
import type { TokenService } from '#src/services/token.service';

export interface ReportsRouterDeps {
  reports: ReportService;
  access: AccessService;
  tokens: Pick<TokenService, 'verify'>;
}

/**
 * The Semestral End Report (docs/PROJECT_WORKFLOW_SPEC.md, section 4), for the organization's
 * officers. Asking for one is the organization's own act (admins do not pass); admins may
 * see the list for support (audited override).
 */
export function reportsRouter({ reports, access, tokens }: ReportsRouterDeps): Router {
  const router = Router();
  const controller = createReportController(reports);
  const { requireOrgRole, requireOwnOrgRole } = createOrgGuards(access);
  const auth = requireAuth(tokens);

  router.post(
    '/organizations/:slug/semestral-reports',
    auth,
    requireOwnOrgRole('officer'),
    controller.request,
  );
  router.get(
    '/organizations/:slug/semestral-reports',
    auth,
    requireOrgRole('officer'),
    controller.list,
  );

  return router;
}
