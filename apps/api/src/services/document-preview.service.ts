import type { DocumentViewerResponse, PreviewStatus } from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import type { Storage } from '#src/lib/storage';
import {
  pageSizesOf,
  type DocumentRecord,
  type DocumentRepository,
} from '#src/repositories/document.repository';
import { PUBLIC_VIEWER, type DocumentViewer } from '#src/repositories/document-visibility';
import { isConstitutionType } from '#src/services/constitution.service';
import type { DocumentViewerService } from '#src/services/document-viewer.service';
import type { PageTokenService } from '#src/services/page-token.service';
import { pageKeyOf, pageThumbnailKeyOf } from '#src/services/preview.service';

export interface DocumentPreviewServiceDeps {
  documents: Pick<DocumentRepository, 'findById' | 'findRenderedPages' | 'findVersionPreview'>;
  viewers: Pick<DocumentViewerService, 'forUser'>;
  pageTokens: Pick<PageTokenService, 'sign' | 'verify'>;
  storage: Pick<Storage, 'read'>;
}

type PreviewedVersion = Pick<
  NonNullable<DocumentRecord['currentVersion']>,
  'id' | 'scanStatus' | 'previewStatus' | 'previewPages' | 'pageCount'
>;

/** A file being scanned shows "Preparing preview…"; a refused one has no preview at all. */
function statusOf(v: PreviewedVersion): PreviewStatus {
  if (v.scanStatus === 'pending') return 'pending';
  if (v.scanStatus !== 'clean') return 'failed';
  return v.previewStatus;
}

/**
 * The view-only viewer. Everyone who may see a document (its visibility, decided by the
 * repository) views its current version through watermarked page images; the original file
 * goes to the owning organization alone, through the download route.
 */
export function createDocumentPreviewService({
  documents,
  viewers,
  pageTokens,
  storage,
}: DocumentPreviewServiceDeps) {
  function viewerFor(userId: string | undefined): Promise<DocumentViewer> {
    return userId ? viewers.forUser(userId) : Promise.resolve(PUBLIC_VIEWER);
  }

  return {
    /**
     * The current version's preview and, once it is ready, a 5-minute token for its pages.
     * 404 when the document does not exist or the viewer may not see it.
     *
     * `versionId` asks for an older version: the owning account may view any of its own, and
     * anyone may view any version of a Constitution & By-laws (its history is public,
     * docs/DOMAIN_RULES.md). Other documents show their current version only.
     */
    async viewer(
      userId: string | undefined,
      documentId: string,
      versionId?: string,
    ): Promise<DocumentViewerResponse> {
      const reader = await viewerFor(userId);
      const doc = await documents.findById(reader, documentId);
      if (!doc?.currentVersion) throw AppError.notFound('Document not found');

      let version: PreviewedVersion | null = doc.currentVersion;
      if (versionId && versionId !== doc.currentVersion.id) {
        const own = reader.kind === 'account' && reader.organizationId === doc.organization.id;
        if (!own && !isConstitutionType(doc.type)) {
          throw AppError.forbidden('Only the current version of this document can be viewed');
        }
        version = await documents.findVersionPreview(reader, documentId, versionId);
      }
      if (!version) throw AppError.notFound('Version not found');

      const status = statusOf(version);
      const pages =
        status === 'ready'
          ? pageSizesOf(version.previewPages).map(([width, height]) => ({ width, height }))
          : [];
      const grant =
        pages.length > 0 ? await pageTokens.sign({ documentId, versionId: version.id }) : null;
      return {
        versionId: version.id,
        status,
        pages,
        totalPages: status === 'ready' ? (version.pageCount ?? pages.length) : 0,
        token: grant?.token ?? null,
        expiresAt: grant?.expiresAt.toISOString() ?? null,
      };
    },

    /**
     * One watermarked page image. The token is the authorization (signed after the
     * visibility check, 5 minutes); 403 when it is expired or for another document, 404 when
     * the page does not exist or the document was deleted since.
     */
    async page(
      documentId: string,
      page: number,
      token: string,
      size: 'full' | 'thumb' = 'full',
    ): Promise<Buffer> {
      const grant = await pageTokens.verify(token);
      if (grant.documentId !== documentId) throw AppError.forbidden('Invalid page link');
      const thumbnails = size === 'thumb';
      const rendered = await documents.findRenderedPages(documentId, grant.versionId, { thumbnails });
      if (rendered === null || page > rendered) throw AppError.notFound('Page not found');
      return storage.read(
        thumbnails
          ? pageThumbnailKeyOf(documentId, grant.versionId, page)
          : pageKeyOf(documentId, grant.versionId, page),
      );
    },
  };
}

export type DocumentPreviewService = ReturnType<typeof createDocumentPreviewService>;
