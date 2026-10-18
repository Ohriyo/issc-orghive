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
 * Every write needs requireAuth plus an org guard on the document's organization. Nothing
 * here reviews or approves documents: their visibility alone decides who sees them.
 */
export function documentsRouter({
  documents,
  uploads,
  access,
  tokens,
}: DocumentsRouterDeps): Router {
  const router = Router();
  const controller = createDocumentController(documents, uploads);
  const { requireOrgRole, requireOwnOrgRole } = createOrgGuards(access);
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
  router.get('/documents/:documentId', optionalAuth(tokens), viewerCache, controller.get);
  router.patch('/documents/:documentId', auth, requireOrgRole('officer'), controller.update);
  // Who can see a document is the organization's own decision: admins cannot change it.
  router.patch(
    '/documents/:documentId/visibility',
    auth,
    requireOwnOrgRole('officer'),
    controller.setVisibility,
  );
  router.delete('/documents/:documentId', auth, requireOrgRole('officer'), controller.remove);
  router.post(
    '/documents/:documentId/archive',
    auth,
    requireOrgRole('officer'),
    controller.archive,
  );
  router.post(
    '/documents/:documentId/restore',
    auth,
    requireOrgRole('officer'),
    controller.restore,
  );

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
