import { Router } from 'express';
import { createDocumentController } from '#src/controllers/document.controller';
import { publicCache, viewerCache } from '#src/middleware/public-cache';
import { createOrgGuards, optionalAuth, requireAuth } from '#src/middleware/require-auth';
import type { AccessService } from '#src/services/access.service';
import type { DocumentService } from '#src/services/document.service';
import type { TokenService } from '#src/services/token.service';
import type { UploadService } from '#src/services/upload.service';

export interface DocumentsRouterDeps {
  documents: DocumentService;
  uploads: UploadService;
  access: AccessService;
  tokens: Pick<TokenService, 'verify'>;
}

/**
 * Paperworks. Reads are public and filtered by the repository for whoever is asking.
 * Every write needs requireAuth plus an org guard on the document's organization.
 */
export function documentsRouter({
  documents,
  uploads,
  access,
  tokens,
}: DocumentsRouterDeps): Router {
  const router = Router();
  const controller = createDocumentController(documents, uploads);
  const { requireOrgRole, requireApprover } = createOrgGuards(access);
  const auth = requireAuth(tokens);

  router.get('/organizations/:slug/documents', optionalAuth(tokens), viewerCache, controller.list);
  // Uploads: get a pre-signed PUT, upload the bytes to storage, then create the document.
  router.post(
    '/organizations/:slug/documents/upload-url',
    auth,
    requireOrgRole('officer'),
    controller.uploadUrl,
  );
  router.post('/organizations/:slug/documents', auth, requireOrgRole('officer'), controller.create);

  router.get('/document-types', publicCache, controller.listTypes);
  router.get('/documents', optionalAuth(tokens), viewerCache, controller.search);
  router.get('/documents/:documentId', optionalAuth(tokens), viewerCache, controller.get);
  router.patch('/documents/:documentId', auth, requireOrgRole('officer'), controller.update);
  router.delete('/documents/:documentId', auth, requireOrgRole('officer'), controller.remove);
  router.post('/documents/:documentId/submit', auth, requireOrgRole('officer'), controller.submit);
  router.post('/documents/:documentId/approve', auth, requireApprover(), controller.approve);
  router.post('/documents/:documentId/reject', auth, requireApprover(), controller.reject);

  router.get('/documents/:documentId/versions', optionalAuth(tokens), controller.listVersions);
  router.post(
    '/documents/:documentId/versions',
    auth,
    requireOrgRole('officer'),
    controller.addVersion,
  );
  router.get(
    '/documents/:documentId/versions/:versionId/download-url',
    optionalAuth(tokens),
    controller.downloadUrl,
  );

  return router;
}
