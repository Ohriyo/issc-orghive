import { Router } from 'express';
import { createDocumentController } from '#src/controllers/document.controller';
import { viewerCache } from '#src/middleware/public-cache';
import { createOrgGuards, optionalAuth, requireAuth } from '#src/middleware/require-auth';
import type { AccessService } from '#src/services/access.service';
import type { DocumentService } from '#src/services/document.service';
import type { TokenService } from '#src/services/token.service';

export interface DocumentsRouterDeps {
  documents: DocumentService;
  access: AccessService;
  tokens: Pick<TokenService, 'verify'>;
}

/**
 * Paperworks. Reads are public and filtered by the repository for whoever is asking.
 * Every write needs requireAuth plus an org guard on the document's organization.
 */
export function documentsRouter({ documents, access, tokens }: DocumentsRouterDeps): Router {
  const router = Router();
  const controller = createDocumentController(documents);
  const { requireOrgRole, requireApprover } = createOrgGuards(access);
  const auth = requireAuth(tokens);

  router.get('/organizations/:slug/documents', optionalAuth(tokens), viewerCache, controller.list);
  router.post('/organizations/:slug/documents', auth, requireOrgRole('officer'), controller.create);

  router.get('/documents/:documentId', optionalAuth(tokens), viewerCache, controller.get);
  router.patch('/documents/:documentId', auth, requireOrgRole('officer'), controller.update);
  router.delete('/documents/:documentId', auth, requireOrgRole('officer'), controller.remove);
  router.post('/documents/:documentId/submit', auth, requireOrgRole('officer'), controller.submit);
  router.post('/documents/:documentId/approve', auth, requireApprover(), controller.approve);
  router.post('/documents/:documentId/reject', auth, requireApprover(), controller.reject);

  return router;
}
