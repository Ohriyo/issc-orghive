import { describe, expect, it, vi } from 'vitest';
import { MAX_PREVIEW_PAGES } from '@orghive/shared';
import { ConversionRejectedError } from '#src/lib/office-converter';
import type { RenderedPage } from '#src/lib/preview-render';
import type { PreviewRecord } from '#src/repositories/document.repository';
import {
  createPreviewService,
  pageKeyOf,
  queuePendingPreviews,
  thumbnailKeyOf,
} from '#src/services/preview.service';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function rec(overrides: Partial<PreviewRecord> = {}): PreviewRecord {
  return {
    id: 'v1',
    storageKey: 'files/org-1/k1',
    originalFilename: 'budget.pdf',
    mimeType: 'application/pdf',
    scanStatus: 'clean',
    previewStatus: 'pending',
    document: { id: 'd1', organization: { slug: 'jpice' }, type: { slug: 'activity-proposal' } },
    ...overrides,
  };
}

const page = (n: number): RenderedPage => ({
  webp: Buffer.from(`page-${n}`),
  width: 1240,
  height: 1754,
});

function setup(record: PreviewRecord | null = rec(), totalPages = 3) {
  const documents = {
    findForPreview: vi.fn(() => Promise.resolve(record)),
    markPreviewReady: vi.fn(() => Promise.resolve()),
    markPreviewFailed: vi.fn(() => Promise.resolve()),
    findPendingPreviews: vi.fn(() => Promise.resolve([] as string[])),
  };
  const storage = {
    read: vi.fn(() => Promise.resolve(Buffer.from('original'))),
    put: vi.fn(() => Promise.resolve()),
  };
  const renderer = {
    renderPdfPages: vi.fn(
      async (
        _pdf: Uint8Array,
        maxPages: number,
        onPage: (p: RenderedPage, n: number) => Promise<void>,
      ) => {
        for (let n = 1; n <= Math.min(totalPages, maxPages); n++) await onPage(page(n), n);
        return { totalPages };
      },
    ),
    renderImagePage: vi.fn(() => Promise.resolve(page(1))),
    thumbnailOf: vi.fn(() => Promise.resolve(Buffer.from('thumb'))),
    pageThumbnailOf: vi.fn((p: Buffer) => Promise.resolve(Buffer.from(`small-${p.toString()}`))),
    pdfStructure: vi.fn(() =>
      Promise.resolve({
        outline: [{ title: 'Code of conduct', page: 2, items: [] }],
        pageTexts: ['Welcome', 'Code of conduct', 'Dress code'],
      }),
    ),
  };
  const converter = { toPdf: vi.fn(() => Promise.resolve(Buffer.from('%PDF converted'))) };
  const cache = {
    deleteMatching: vi.fn(() => Promise.resolve()),
    bump: vi.fn(() => Promise.resolve()),
  };
  const logger = { warn: vi.fn(), info: vi.fn() };
  const service = createPreviewService({ documents, storage, renderer, converter, cache, logger });
  return { service, documents, storage, renderer, converter, cache };
}

describe('previewService.renderVersion', () => {
  it('renders every PDF page privately, makes the thumbnail from page 1, and marks it ready', async () => {
    const { service, documents, storage, renderer, cache } = setup();
    expect(await service.renderVersion('v1')).toBe('ready');
    expect(storage.read).toHaveBeenCalledWith('files/org-1/k1');
    expect(renderer.renderPdfPages).toHaveBeenCalledWith(
      Buffer.from('original'),
      MAX_PREVIEW_PAGES,
      expect.any(Function),
    );
    for (const n of [1, 2, 3]) {
      expect(storage.put).toHaveBeenCalledWith(
        `pages/d1/v1/${n}.webp`,
        Buffer.from(`page-${n}`),
        'image/webp',
        'private, max-age=300',
      );
    }
    expect(renderer.thumbnailOf).toHaveBeenCalledWith(Buffer.from('page-1'));
    expect(storage.put).toHaveBeenCalledWith(
      'thumbnails/d1/v1.webp',
      Buffer.from('thumb'),
      'image/webp',
    );
    expect(documents.markPreviewReady).toHaveBeenCalledWith('v1', {
      pages: [
        [1240, 1754],
        [1240, 1754],
        [1240, 1754],
      ],
      pageCount: 3,
      thumbnailKey: 'thumbnails/d1/v1.webp',
    });
    expect(cache.deleteMatching).toHaveBeenCalledWith('org:jpice:docs:*');
  });

  it('records the full length of a file longer than the cap', async () => {
    const { service, documents } = setup(rec(), MAX_PREVIEW_PAGES + 20);
    await service.renderVersion('v1');
    const [, result] = documents.markPreviewReady.mock.calls[0] as unknown as [
      string,
      { pages: unknown[]; pageCount: number },
    ];
    expect(result.pages).toHaveLength(MAX_PREVIEW_PAGES);
    expect(result.pageCount).toBe(MAX_PREVIEW_PAGES + 20);
  });

  it('converts Office files to PDF with LibreOffice first', async () => {
    const { service, converter, renderer } = setup(rec({ mimeType: DOCX }));
    expect(await service.renderVersion('v1')).toBe('ready');
    expect(converter.toPdf).toHaveBeenCalledWith(Buffer.from('original'), DOCX);
    expect(renderer.renderPdfPages.mock.calls[0]![0]).toEqual(Buffer.from('%PDF converted'));
  });

  it('watermarks an image upload as its one page', async () => {
    const { service, renderer, documents, converter } = setup(rec({ mimeType: 'image/png' }));
    expect(await service.renderVersion('v1')).toBe('ready');
    expect(renderer.renderImagePage).toHaveBeenCalled();
    expect(renderer.renderPdfPages).not.toHaveBeenCalled();
    expect(converter.toPdf).not.toHaveBeenCalled();
    expect(documents.markPreviewReady).toHaveBeenCalledWith(
      'v1',
      expect.objectContaining({ pages: [[1240, 1754]], pageCount: 1 }),
    );
  });

  it('skips anything not clean and pending, so retried and repeated jobs are harmless', async () => {
    for (const record of [
      null,
      rec({ scanStatus: 'pending' }),
      rec({ scanStatus: 'infected' }),
      rec({ previewStatus: 'ready' }),
      rec({ previewStatus: 'failed' }),
    ]) {
      const { service, storage } = setup(record);
      expect(await service.renderVersion('v1')).toBe('skipped');
      expect(storage.read).not.toHaveBeenCalled();
    }
  });

  it('marks a file LibreOffice rejects as failed at once, without retrying', async () => {
    const { service, documents, converter, cache } = setup(rec({ mimeType: DOCX }));
    converter.toPdf.mockRejectedValueOnce(new ConversionRejectedError('corrupt'));
    expect(await service.renderVersion('v1')).toBe('failed');
    expect(documents.markPreviewFailed).toHaveBeenCalledWith('v1');
    expect(documents.markPreviewReady).not.toHaveBeenCalled();
    expect(cache.deleteMatching).toHaveBeenCalledWith('org:jpice:docs:*');
  });

  it('marks a damaged or encrypted PDF as failed at once', async () => {
    for (const name of ['InvalidPDFException', 'PasswordException']) {
      const { service, documents, renderer } = setup();
      renderer.renderPdfPages.mockRejectedValueOnce(Object.assign(new Error('bad'), { name }));
      expect(await service.renderVersion('v1')).toBe('failed');
      expect(documents.markPreviewFailed).toHaveBeenCalledWith('v1');
    }
  });

  it('fails a PDF with no pages', async () => {
    const { service, documents } = setup(rec(), 0);
    expect(await service.renderVersion('v1')).toBe('failed');
    expect(documents.markPreviewFailed).toHaveBeenCalled();
  });

  it('lets other errors throw so BullMQ retries, and fails only on the last attempt', async () => {
    const { service, documents, converter } = setup(rec({ mimeType: DOCX }));
    converter.toPdf.mockRejectedValue(new Error('Gotenberg answered 503'));
    await expect(service.renderVersion('v1')).rejects.toThrow('503');
    expect(documents.markPreviewFailed).not.toHaveBeenCalled();
    expect(await service.renderVersion('v1', { lastAttempt: true })).toBe('failed');
    expect(documents.markPreviewFailed).toHaveBeenCalledWith('v1');
  });
});

describe('preview keys', () => {
  it('keeps page images and thumbnails under their own private prefixes', () => {
    expect(pageKeyOf('d1', 'v1', 7)).toBe('pages/d1/v1/7.webp');
    expect(thumbnailKeyOf('d1', 'v1')).toBe('thumbnails/d1/v1.webp');
  });
});

describe('queuePendingPreviews', () => {
  function pending(ids: string[]) {
    const findPendingPreviews = vi.fn(
      ({ afterId, limit = 100 }: { afterId?: string; limit?: number } = {}) => {
        const start = afterId ? ids.indexOf(afterId) + 1 : 0;
        return Promise.resolve(ids.slice(start, start + limit));
      },
    );
    const queue = { enqueuePreview: vi.fn(() => Promise.resolve()) };
    return { documents: { findPendingPreviews }, queue };
  }

  it('queues every pending version, page by page', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `v${String(i).padStart(3, '0')}`);
    const deps = pending(ids);
    expect(await queuePendingPreviews(deps)).toBe(250);
    expect(deps.queue.enqueuePreview.mock.calls.map(([id]: unknown[]) => id)).toEqual(ids);
    expect(deps.documents.findPendingPreviews).toHaveBeenCalledTimes(4);
  });

  it('stops at `max` and passes `before` through (the worker sweep)', async () => {
    const deps = pending(['a', 'b', 'c', 'd']);
    const before = new Date('2026-10-20T00:00:00Z');
    expect(await queuePendingPreviews(deps, { before, max: 3 })).toBe(3);
    expect(deps.documents.findPendingPreviews).toHaveBeenCalledWith({
      before,
      afterId: undefined,
      limit: 3,
    });
  });

  it('queues nothing when every file has its preview', async () => {
    expect(await queuePendingPreviews(pending([]))).toBe(0);
  });
});

describe('previewService and the Student Handbook', () => {
  const handbook = (mimeType = 'application/pdf') =>
    rec({
      mimeType,
      document: { id: 'd1', organization: { slug: 'issc' }, type: { slug: 'student-handbook' } },
    });

  it('also stores page thumbnails, the bookmarks and each page text', async () => {
    const { service, documents, storage, renderer } = setup(handbook());
    expect(await service.renderVersion('v1')).toBe('ready');
    for (const n of [1, 2, 3]) {
      expect(storage.put).toHaveBeenCalledWith(
        `pages/d1/v1/thumbs/${n}.webp`,
        Buffer.from(`small-page-${n}`),
        'image/webp',
        'private, max-age=300',
      );
    }
    expect(renderer.pdfStructure).toHaveBeenCalledWith(Buffer.from('original'), MAX_PREVIEW_PAGES);
    expect(documents.markPreviewReady).toHaveBeenCalledWith(
      'v1',
      expect.objectContaining({
        handbook: {
          outline: [{ title: 'Code of conduct', page: 2, items: [] }],
          pageTexts: ['Welcome', 'Code of conduct', 'Dress code'],
        },
      }),
    );
  });

  it('does none of that for other documents', async () => {
    const { service, documents, renderer } = setup();
    await service.renderVersion('v1');
    expect(renderer.pageThumbnailOf).not.toHaveBeenCalled();
    expect(renderer.pdfStructure).not.toHaveBeenCalled();
    expect(documents.markPreviewReady).toHaveBeenCalledWith(
      'v1',
      expect.not.objectContaining({ handbook: expect.anything() as unknown }),
    );
  });
});
