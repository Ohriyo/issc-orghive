import { Router } from 'express';
import { createDocumentController } from '#src/controllers/document.controller';
import { publicCache, viewerCache } from '#src/middleware/public-cache';
import { viewerRateLimits, type RateLimitStoreFactory } from '#src/middleware/rate-limit';
import { createOrgGuards, optionalAuth, requireAuth } from '#src/middleware/require-auth';
import type { AccessService } from '#src/services/access.service';
import type { DocumentPreviewService } from '#src/services/document-preview.service';
import type { DocumentService } from '#src/services/document.service';
import type { TokenService } from '#src/services/token.service';
import type { UploadService } from '#src/services/upload.service';

export interface DocumentsRouterDeps {
  documents: DocumentService;
  previews: DocumentPreviewService;
  uploads: UploadService;
  access: AccessService;
  tokens: Pick<TokenService, 'verify'>;
  /** Redis in the app; in-memory in tests. */
  rateLimitStore?: RateLimitStoreFactory;
}

/**
 * Paperworks. Reads are public and filtered by the repository for whoever is asking.
 * Every write needs requireAuth plus an org guard on the document's organization. Nothing
 * here reviews or approves documents: their visibility alone decides who sees them.
 * Non-owners view documents only through the watermarked page images; the original file is
 * downloaded by the owning organization's account alone.
 */
export function documentsRouter({
  documents,
  previews,
  uploads,
  access,
  tokens,
  rateLimitStore,
}: DocumentsRouterDeps): Router {
  const router = Router();
  const controller = createDocumentController(documents, uploads, previews);
  const limits = viewerRateLimits(rateLimitStore);
  const { requireOwnOrg, requireActiveOrg } = createOrgGuards(access);
  const auth = requireAuth(tokens);

  router.get('/organizations/:slug/documents', optionalAuth(tokens), viewerCache, controller.list);
  // Uploads: get a pre-signed PUT, upload the bytes to storage, then create the document.
  router.post(
    '/organizations/:slug/documents/upload-url',
    auth,
    requireOwnOrg,
    requireActiveOrg,
    controller.uploadUrl,
  );
  // A deactivated organization cannot upload (docs/DOMAIN_RULES.md, "Administration").
  router.post(
    '/organizations/:slug/documents',
    auth,
    requireOwnOrg,
    requireActiveOrg,
    controller.create,
  );

  router.get('/document-types', publicCache, controller.listTypes);
  router.get('/documents/:documentId', optionalAuth(tokens), viewerCache, controller.get);
  router.patch('/documents/:documentId', auth, requireOwnOrg, controller.update);
  // Who can see a document is the organization's own decision (docs/DOMAIN_RULES.md).
  router.patch('/documents/:documentId/visibility', auth, requireOwnOrg, controller.setVisibility);
  router.delete('/documents/:documentId', auth, requireOwnOrg, controller.remove);
  router.post('/documents/:documentId/archive', auth, requireOwnOrg, controller.archive);
  router.post('/documents/:documentId/restore', auth, requireOwnOrg, controller.restore);

  router.get('/documents/:documentId/versions', optionalAuth(tokens), controller.listVersions);
  router.post(
    '/documents/:documentId/versions',
    auth,
    requireOwnOrg,
    requireActiveOrg,
    controller.addVersion,
  );
  // The original file: the owning organization's account only (401 signed out, 403 others).
  router.get(
    '/documents/:documentId/versions/:versionId/download-url',
    auth,
    requireOwnOrg,
    controller.downloadUrl,
  );

  // The view-only viewer: whoever may see the document, signed in or not.
  router.get(
    '/documents/:documentId/viewer',
    limits.viewer,
    optionalAuth(tokens),
    controller.viewer,
  );
  // Authorized by the signed page token instead of a session: an <img> cannot send it.
  router.get('/documents/:documentId/pages/:page', limits.pages, controller.page);

  return router;
}
