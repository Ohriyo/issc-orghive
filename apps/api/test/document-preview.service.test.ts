import { describe, expect, it, vi } from 'vitest';
import { AppError } from '#src/errors/app-error';
import type { DocumentRecord } from '#src/repositories/document.repository';
import type { DocumentViewer } from '#src/repositories/document-visibility';
import { createDocumentPreviewService } from '#src/services/document-preview.service';

const AT = new Date('2026-10-20T00:00:00Z');
const OWNER: DocumentViewer = {
  kind: 'account',
  userId: 'u1',
  organizationId: 'jpice',
  organizationType: 'SBO',
};

type Version = NonNullable<DocumentRecord['currentVersion']>;

function doc(version: Partial<Version> | null = {}): DocumentRecord {
  return {
    id: 'd1',
    title: 'Proposal',
    description: null,
    academicYear: '2026-2027',
    semester: null,
    status: 'available',
    visibility: 'public',
    tags: [],
    createdAt: AT,
    updatedAt: AT,
    organization: { id: 'jpice', slug: 'jpice', acronym: 'JPICE', name: 'JPICE', type: 'SBO' },
    type: { id: 't1', slug: 'proposal', name: 'Proposal' },
    currentVersion: version && {
      id: 'v1',
      version: 1,
      originalFilename: 'p.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      scanStatus: 'clean',
      thumbnailKey: 'thumbnails/d1/v1.webp',
      previewStatus: 'ready',
      previewPages: [
        [1240, 1754],
        [1754, 1240],
      ],
      pageCount: 2,
      createdAt: AT,
      ...version,
    },
  };
}

const OLD_VERSION = {
  id: 'v0',
  scanStatus: 'clean' as const,
  previewStatus: 'ready' as const,
  previewPages: [[1240, 1754]],
  pageCount: 1,
};

function setup(
  record: DocumentRecord | null = doc(),
  rendered: number | null = 2,
  viewer: DocumentViewer = OWNER,
) {
  const documents = {
    findById: vi.fn((_viewer: DocumentViewer, _id: string) => Promise.resolve(record)),
    findRenderedPages: vi.fn(() => Promise.resolve(rendered)),
    findVersionPreview: vi.fn((_viewer: DocumentViewer, _id: string, versionId: string) =>
      Promise.resolve(versionId === 'v0' ? OLD_VERSION : null),
    ),
  };
  const viewers = { forUser: vi.fn(() => Promise.resolve(viewer)) };
  const pageTokens = {
    sign: vi.fn(() => Promise.resolve({ token: 'page-token', expiresAt: AT })),
    verify: vi.fn((token: string) =>
      token === 'page-token'
        ? Promise.resolve({ documentId: 'd1', versionId: 'v1' })
        : Promise.reject(AppError.forbidden('Invalid page link')),
    ),
  };
  const storage = { read: vi.fn((key: string) => Promise.resolve(Buffer.from(key))) };
  const service = createDocumentPreviewService({ documents, viewers, pageTokens, storage });
  return { service, documents, viewers, pageTokens, storage };
}

describe('documentPreviewService.viewer', () => {
  it('lists the rendered pages and signs a page token for the current version', async () => {
    const { service, pageTokens } = setup();
    expect(await service.viewer(undefined, 'd1')).toEqual({
      versionId: 'v1',
      status: 'ready',
      pages: [
        { width: 1240, height: 1754 },
        { width: 1754, height: 1240 },
      ],
      totalPages: 2,
      token: 'page-token',
      expiresAt: AT.toISOString(),
    });
    expect(pageTokens.sign).toHaveBeenCalledWith({ documentId: 'd1', versionId: 'v1' });
  });

  it('asks the repository as the signed-in account, or as the public', async () => {
    const { service, documents, viewers } = setup();
    await service.viewer('u1', 'd1');
    expect(viewers.forUser).toHaveBeenCalledWith('u1');
    expect(documents.findById).toHaveBeenLastCalledWith(OWNER, 'd1');
    await service.viewer(undefined, 'd1');
    expect(documents.findById).toHaveBeenLastCalledWith({ kind: 'public' }, 'd1');
  });

  it('404s a document the viewer may not see, or one with no file', async () => {
    await expect(setup(null).service.viewer(undefined, 'd1')).rejects.toMatchObject({
      status: 404,
    });
    await expect(setup(doc(null)).service.viewer(undefined, 'd1')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('says pending (no token) while the file is scanned or its pages are rendered', async () => {
    for (const version of [
      { scanStatus: 'pending' as const },
      { previewStatus: 'pending' as const },
    ]) {
      const { service, pageTokens } = setup(
        doc({ ...version, previewPages: null, pageCount: null }),
      );
      expect(await service.viewer('u1', 'd1')).toMatchObject({
        status: 'pending',
        pages: [],
        totalPages: 0,
        token: null,
        expiresAt: null,
      });
      expect(pageTokens.sign).not.toHaveBeenCalled();
    }
  });

  it('says failed for a refused file or one that could not be rendered', async () => {
    for (const version of [
      { scanStatus: 'infected' as const },
      { previewStatus: 'failed' as const },
    ]) {
      const { service } = setup(doc(version));
      expect(await service.viewer('u1', 'd1')).toMatchObject({ status: 'failed', token: null });
    }
  });

  it('reports the full length of a capped file', async () => {
    const { service } = setup(doc({ pageCount: 812 }));
    expect((await service.viewer(undefined, 'd1')).totalPages).toBe(812);
  });
});

describe('documentPreviewService.viewer with a version', () => {
  const OTHER: DocumentViewer = {
    kind: 'account',
    userId: 'u2',
    organizationId: 'iecep',
    organizationType: 'SBO',
  };
  const constitution = () => ({
    ...doc(),
    type: { id: 't-con', slug: 'constitution-by-laws', name: 'Constitution & By-laws' },
  });

  it('lets anyone view an older version of a constitution', async () => {
    const { service, pageTokens } = setup(constitution(), 2, OTHER);
    const result = await service.viewer(undefined, 'd1', 'v0');
    expect(result).toMatchObject({ versionId: 'v0', status: 'ready', totalPages: 1 });
    expect(pageTokens.sign).toHaveBeenCalledWith({ documentId: 'd1', versionId: 'v0' });
  });

  it('lets the owner view an older version of any of its documents', async () => {
    const { service } = setup(doc(), 2, OWNER);
    expect((await service.viewer('u1', 'd1', 'v0')).versionId).toBe('v0');
  });

  it('403s an older version of another organization’s ordinary document', async () => {
    const { service, documents } = setup(doc(), 2, OTHER);
    await expect(service.viewer('u2', 'd1', 'v0')).rejects.toMatchObject({ status: 403 });
    expect(documents.findVersionPreview).not.toHaveBeenCalled();
  });

  it('404s a version the reader may not see', async () => {
    const { service } = setup(constitution());
    await expect(service.viewer(undefined, 'd1', 'v9')).rejects.toMatchObject({ status: 404 });
  });

  it('treats the current version id like no version at all', async () => {
    const { service, documents } = setup(doc(), 2, OTHER);
    expect((await service.viewer('u2', 'd1', 'v1')).versionId).toBe('v1');
    expect(documents.findVersionPreview).not.toHaveBeenCalled();
  });
});

describe('documentPreviewService.page', () => {
  it('reads the page image of the version the token grants', async () => {
    const { service, storage, documents } = setup();
    expect((await service.page('d1', 2, 'page-token')).toString()).toBe('pages/d1/v1/2.webp');
    expect(documents.findRenderedPages).toHaveBeenCalledWith('d1', 'v1', { thumbnails: false });
    expect(storage.read).toHaveBeenCalledWith('pages/d1/v1/2.webp');
  });

  it('reads the small copy for the handbook contents, if the version has them', async () => {
    const { service, storage, documents } = setup();
    expect((await service.page('d1', 2, 'page-token', 'thumb')).toString()).toBe(
      'pages/d1/v1/thumbs/2.webp',
    );
    expect(documents.findRenderedPages).toHaveBeenCalledWith('d1', 'v1', { thumbnails: true });
    expect(storage.read).toHaveBeenCalledWith('pages/d1/v1/thumbs/2.webp');
  });

  it('403s a bad token or one for another document', async () => {
    const { service, storage } = setup();
    await expect(service.page('d1', 1, 'forged')).rejects.toMatchObject({ status: 403 });
    await expect(service.page('d2', 1, 'page-token')).rejects.toMatchObject({ status: 403 });
    expect(storage.read).not.toHaveBeenCalled();
  });

  it('404s a page past the last, or once the document is gone', async () => {
    await expect(setup().service.page('d1', 3, 'page-token')).rejects.toMatchObject({
      status: 404,
    });
    await expect(setup(doc(), null).service.page('d1', 1, 'page-token')).rejects.toMatchObject({
      status: 404,
    });
  });
});
