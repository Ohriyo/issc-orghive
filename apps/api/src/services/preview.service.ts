import { HANDBOOK_DOCUMENT_TYPE, MAX_PREVIEW_PAGES } from '@orghive/shared';
import { type Cache, invalidateDocuments } from '#src/lib/cache';
import {
  ConversionRejectedError,
  isOfficeType,
  type OfficeConverter,
} from '#src/lib/office-converter';
import type { PdfStructure } from '#src/lib/pdf-structure';
import type { RenderedPage } from '#src/lib/preview-render';
import type { Storage } from '#src/lib/storage';
import type { Logger } from '#src/logger';
import type { DocumentRepository, PageSize } from '#src/repositories/document.repository';

/** The rendering helpers (lib/preview-render in production, fakes in tests). */
export interface PreviewRenderer {
  renderPdfPages(
    pdf: Uint8Array,
    maxPages: number,
    onPage: (page: RenderedPage, pageNumber: number) => Promise<void>,
  ): Promise<{ totalPages: number }>;
  renderImagePage(body: Uint8Array): Promise<RenderedPage>;
  thumbnailOf(page: Buffer): Promise<Buffer>;
  /** Student Handbook only: the small page images its contents show. */
  pageThumbnailOf(page: Buffer): Promise<Buffer>;
  /** Student Handbook only: bookmarks and each page's text. */
  pdfStructure(pdf: Uint8Array, maxPages: number): Promise<PdfStructure>;
}

export interface PreviewServiceDeps {
  documents: Pick<
    DocumentRepository,
    'findForPreview' | 'markPreviewReady' | 'markPreviewFailed' | 'findPendingPreviews'
  >;
  storage: Pick<Storage, 'read' | 'put'>;
  renderer: PreviewRenderer;
  converter: OfficeConverter;
  cache: Pick<Cache, 'deleteMatching' | 'bump'>;
  logger: Pick<Logger, 'warn' | 'info'>;
}

export type PreviewOutcome = 'ready' | 'failed' | 'skipped';

/** Page images live under their own private prefix; only the page route reads them. */
export function pageKeyOf(documentId: string, versionId: string, page: number): string {
  return `pages/${documentId}/${versionId}/${page}.webp`;
}

export function thumbnailKeyOf(documentId: string, versionId: string): string {
  return `thumbnails/${documentId}/${versionId}.webp`;
}

/** The handbook's contents thumbnails, next to the page images (served the same way). */
export function pageThumbnailKeyOf(documentId: string, versionId: string, page: number): string {
  return `pages/${documentId}/${versionId}/thumbs/${page}.webp`;
}

/**
 * Errors that are the file's own fault: retrying fails the same way. pdf.js names its
 * exceptions; LibreOffice's refusals come back as ConversionRejectedError.
 */
function isPermanent(err: unknown): boolean {
  if (err instanceof ConversionRejectedError) return true;
  const name = err instanceof Error ? err.name : '';
  return ['InvalidPDFException', 'PasswordException', 'FormatError'].includes(name);
}

const PAGE_CACHE_CONTROL = 'private, max-age=300';

/**
 * Renders a clean version's view-only preview: every page (up to MAX_PREVIEW_PAGES) as a
 * watermarked WebP, plus the card thumbnail from page 1. Non-owners only ever see these;
 * the original stays with the owning organization (CLAUDE.md, "Security rules").
 */
export function createPreviewService({
  documents,
  storage,
  renderer,
  converter,
  cache,
  logger,
}: PreviewServiceDeps) {
  return {
    /**
     * Idempotent: anything not clean and pending is skipped. Pages are written under fixed
     * keys, so a retried job overwrites its own half-done work. A file that cannot be rendered
     * is marked failed at once; other errors (storage, Gotenberg down) throw so BullMQ
     * retries, and `lastAttempt` marks it failed when the retries run out.
     */
    async renderVersion(
      versionId: string,
      { lastAttempt = false }: { lastAttempt?: boolean } = {},
    ): Promise<PreviewOutcome> {
      const rec = await documents.findForPreview(versionId);
      if (!rec || rec.scanStatus !== 'clean' || rec.previewStatus !== 'pending') return 'skipped';
      const documentId = rec.document.id;
      // The handbook also gets page thumbnails, bookmarks and page texts (its contents, search).
      const isHandbook =
        rec.document.type.slug === HANDBOOK_DOCUMENT_TYPE.slug && rec.mimeType === 'application/pdf';

      const pages: PageSize[] = [];
      const first: { page?: Buffer } = {};
      const store = async (page: RenderedPage, n: number) => {
        await storage.put(
          pageKeyOf(documentId, versionId, n),
          page.webp,
          'image/webp',
          PAGE_CACHE_CONTROL,
        );
        pages.push([page.width, page.height]);
        if (n === 1) first.page = page.webp;
        if (isHandbook) {
          await storage.put(
            pageThumbnailKeyOf(documentId, versionId, n),
            await renderer.pageThumbnailOf(page.webp),
            'image/webp',
            PAGE_CACHE_CONTROL,
          );
        }
      };

      let totalPages: number;
      let handbook: PdfStructure | undefined;
      try {
        const body = await storage.read(rec.storageKey);
        if (rec.mimeType === 'image/jpeg' || rec.mimeType === 'image/png') {
          await store(await renderer.renderImagePage(body), 1);
          totalPages = 1;
        } else {
          const pdf =
            rec.mimeType === 'application/pdf'
              ? body
              : isOfficeType(rec.mimeType)
                ? await converter.toPdf(body, rec.mimeType)
                : null;
          if (!pdf) throw new ConversionRejectedError(`No preview for ${rec.mimeType}`);
          ({ totalPages } = await renderer.renderPdfPages(pdf, MAX_PREVIEW_PAGES, store));
          if (isHandbook) handbook = await renderer.pdfStructure(pdf, MAX_PREVIEW_PAGES);
        }
        if (!first.page) throw new ConversionRejectedError('The file has no pages');
      } catch (err) {
        if (!isPermanent(err) && !lastAttempt) throw err;
        await documents.markPreviewFailed(versionId);
        await invalidateDocuments(cache, rec.document.organization.slug);
        logger.warn({ err, versionId }, 'Could not render the view-only preview');
        return 'failed';
      }

      const thumbnailKey = thumbnailKeyOf(documentId, versionId);
      await storage.put(thumbnailKey, await renderer.thumbnailOf(first.page), 'image/webp');
      await documents.markPreviewReady(versionId, {
        pages,
        pageCount: totalPages,
        thumbnailKey,
        ...(handbook && { handbook }),
      });
      // Cached lists carry the thumbnail key: drop them so cards show the new preview.
      await invalidateDocuments(cache, rec.document.organization.slug);
      logger.info({ versionId, pages: pages.length }, 'Preview rendered');
      return 'ready';
    },
  };
}

export type PreviewService = ReturnType<typeof createPreviewService>;

/**
 * Queues the preview of every clean version still waiting for one: the one-time backfill
 * (`pnpm --filter api pages:backfill`) and the worker's sweep for lost jobs (`before`).
 */
export async function queuePendingPreviews(
  deps: {
    documents: Pick<DocumentRepository, 'findPendingPreviews'>;
    queue: { enqueuePreview(versionId: string): Promise<void> };
  },
  options: { before?: Date; max?: number } = {},
): Promise<number> {
  let queued = 0;
  let afterId: string | undefined;
  const max = options.max ?? Number.POSITIVE_INFINITY;
  while (queued < max) {
    const ids = await deps.documents.findPendingPreviews({
      before: options.before,
      afterId,
      limit: Math.min(100, max - queued),
    });
    if (ids.length === 0) break;
    for (const id of ids) await deps.queue.enqueuePreview(id);
    queued += ids.length;
    afterId = ids.at(-1);
  }
  return queued;
}
