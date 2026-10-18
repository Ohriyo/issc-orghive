import { describe, expect, it, vi } from 'vitest';
import type { ScanResult } from '#src/lib/clamav';
import type { ProcessingRecord } from '#src/repositories/document.repository';
import { createPendingRequeue, createProcessingService } from '#src/services/processing.service';

const NOW = new Date('2026-10-16T00:00:00Z');
const BODY = Buffer.from('%PDF-1.7 fake but sized');

function rec(overrides: Partial<ProcessingRecord> = {}): ProcessingRecord {
  return {
    id: 'v1',
    version: 1,
    storageKey: 'uploads/org-1/k1',
    mimeType: 'application/pdf',
    sizeBytes: BODY.length,
    scanStatus: 'pending',
    document: {
      id: 'd1',
      status: 'scanning',
      currentVersionId: 'v1',
      organization: { id: 'org-1', slug: 'jpice' },
    },
    ...overrides,
  };
}

interface SetupOptions {
  record?: ProcessingRecord | null;
  body?: Buffer;
  scan?: ScanResult;
  detected?: string;
  thumbnailFails?: boolean;
}

function setup(options: SetupOptions = {}) {
  const {
    record = rec(),
    body = BODY,
    scan = { clean: true },
    detected = 'application/pdf',
    thumbnailFails = false,
  } = options;
  const documents = {
    findForProcessing: vi.fn(() => Promise.resolve(record)),
    markClean: vi.fn(() => Promise.resolve({ becameCurrent: false })),
    markRefused: vi.fn(() => Promise.resolve({ quarantinedDocument: true })),
  };
  const intents = {
    listAbandoned: vi.fn(() => Promise.resolve(['uploads/org-1/old1', 'uploads/org-1/old2'])),
    deleteMany: vi.fn(() => Promise.resolve()),
  };
  const storage = {
    read: vi.fn(() => Promise.resolve(body)),
    put: vi.fn(() => Promise.resolve()),
    move: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve()),
  };
  const scanner = { scan: vi.fn(() => Promise.resolve(scan)) };
  const tools = {
    detectMimeType: vi.fn(() => Promise.resolve(detected)),
    sha256Hex: vi.fn(() => 'f'.repeat(64)),
    pdfThumbnail: vi.fn(() =>
      thumbnailFails
        ? Promise.reject(new Error('broken PDF'))
        : Promise.resolve(Buffer.from('webp')),
    ),
    pdfText: vi.fn(() => Promise.resolve('truss lattice')),
    imageThumbnail: vi.fn(() => Promise.resolve(Buffer.from('webp'))),
  };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  const cache = {
    deleteMatching: vi.fn(() => Promise.resolve()),
    bump: vi.fn(() => Promise.resolve()),
  };
  const logger = { warn: vi.fn(), info: vi.fn() };
  const onDocumentScanned = vi.fn(() => Promise.resolve());
  const service = createProcessingService({
    documents,
    intents,
    storage,
    scanner,
    tools,
    audit,
    cache,
    logger,
    onDocumentScanned,
    now: () => NOW,
  });
  return { service, documents, intents, storage, scanner, tools, audit, cache, onDocumentScanned };
}

describe('processingService: project tasks', () => {
  it('tells the project side once a file is clean, so its task can be submitted', async () => {
    const { service, onDocumentScanned } = setup();
    await service.processVersion('v1');
    expect(onDocumentScanned).toHaveBeenCalledWith('d1');
  });

  it('does not when the file is refused', async () => {
    const { service, onDocumentScanned } = setup({ scan: { clean: false, signature: 'Eicar' } });
    await service.processVersion('v1');
    expect(onDocumentScanned).not.toHaveBeenCalled();
  });
});

describe('processingService.processVersion', () => {
  it('scans, checks the type, previews, extracts text and marks a clean PDF', async () => {
    const { service, documents, storage, scanner, cache } = setup();
    expect(await service.processVersion('v1')).toBe('clean');
    expect(scanner.scan).toHaveBeenCalledWith(BODY);
    expect(storage.put).toHaveBeenCalledWith(
      'thumbnails/d1/v1.webp',
      Buffer.from('webp'),
      'image/webp',
    );
    expect(documents.markClean).toHaveBeenCalledWith(
      'v1',
      {
        sha256: 'f'.repeat(64),
        thumbnailKey: 'thumbnails/d1/v1.webp',
        contentText: 'truss lattice',
      },
      NOW,
    );
    expect(cache.deleteMatching).toHaveBeenCalledWith('org:jpice:docs:*');
    expect(cache.bump).toHaveBeenCalledWith('search:gen');
  });

  it('quarantines an infected file and its document, and audits it', async () => {
    const { service, documents, storage, audit, tools } = setup({
      scan: { clean: false, signature: 'Eicar-Test-Signature' },
    });
    expect(await service.processVersion('v1')).toBe('infected');
    expect(storage.move).toHaveBeenCalledWith('uploads/org-1/k1', 'quarantine/org-1/k1');
    expect(documents.markRefused).toHaveBeenCalledWith(
      'v1',
      {
        scanStatus: 'infected',
        reason: 'ClamAV: Eicar-Test-Signature',
        quarantineKey: 'quarantine/org-1/k1',
      },
      NOW,
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'quarantine',
        entityId: 'v1',
        organizationId: 'org-1',
        metadata: expect.objectContaining({ quarantinedDocument: true }) as unknown,
      }),
    );
    expect(documents.markClean).not.toHaveBeenCalled();
    // A virus is reported as a virus, before the type check runs.
    expect(tools.detectMimeType).not.toHaveBeenCalled();
  });

  it('refuses bytes that are not the declared type (a PDF named .docx)', async () => {
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const { service, documents } = setup({
      record: rec({ mimeType: docx }),
      detected: 'application/pdf',
    });
    expect(await service.processVersion('v1')).toBe('invalid');
    expect(documents.markRefused).toHaveBeenCalledWith(
      'v1',
      expect.objectContaining({
        scanStatus: 'invalid',
        reason: `Content is application/pdf, not ${docx}`,
      }),
      NOW,
    );
  });

  it('refuses a stored object whose size differs from what was declared', async () => {
    const { service, scanner } = setup({ body: Buffer.alloc(BODY.length + 1) });
    expect(await service.processVersion('v1')).toBe('invalid');
    expect(scanner.scan).not.toHaveBeenCalled();
  });

  it('still marks a clean file whose preview fails', async () => {
    const { service, documents, storage } = setup({ thumbnailFails: true });
    expect(await service.processVersion('v1')).toBe('clean');
    expect(storage.put).not.toHaveBeenCalled();
    expect(documents.markClean).toHaveBeenCalledWith(
      'v1',
      expect.objectContaining({ thumbnailKey: null, contentText: 'truss lattice' }),
      NOW,
    );
  });

  it('previews images without extracting text', async () => {
    const { service, documents, tools } = setup({
      record: rec({ mimeType: 'image/png' }),
      detected: 'image/png',
    });
    expect(await service.processVersion('v1')).toBe('clean');
    expect(tools.imageThumbnail).toHaveBeenCalled();
    expect(tools.pdfText).not.toHaveBeenCalled();
    expect(documents.markClean).toHaveBeenCalledWith(
      'v1',
      expect.objectContaining({ contentText: null }),
      NOW,
    );
  });

  it('skips versions already processed or gone (retried jobs are harmless)', async () => {
    expect(await setup({ record: rec({ scanStatus: 'clean' }) }).service.processVersion('v1')).toBe(
      'skipped',
    );
    expect(await setup({ record: null }).service.processVersion('v1')).toBe('skipped');
  });

  it('lets scanner errors throw so the job is retried, leaving the file pending', async () => {
    const { service, scanner, documents } = setup();
    scanner.scan.mockRejectedValueOnce(new Error('clamd timed out'));
    await expect(service.processVersion('v1')).rejects.toThrow('clamd timed out');
    expect(documents.markClean).not.toHaveBeenCalled();
    expect(documents.markRefused).not.toHaveBeenCalled();
  });
});

describe('processingService.sweepAbandonedUploads', () => {
  it('deletes objects and intents whose URL expired over an hour ago', async () => {
    const { service, intents, storage } = setup();
    expect(await service.sweepAbandonedUploads()).toBe(2);
    expect(intents.listAbandoned).toHaveBeenCalledWith(new Date('2026-10-15T23:00:00Z'));
    expect(storage.delete).toHaveBeenCalledTimes(2);
    expect(intents.deleteMany).toHaveBeenCalledWith(['uploads/org-1/old1', 'uploads/org-1/old2']);
  });
});

describe('createPendingRequeue', () => {
  it('queues versions stuck in pending again', async () => {
    const queue = { enqueueProcessing: vi.fn(() => Promise.resolve()) };
    const requeue = createPendingRequeue({
      findStalePending: () => Promise.resolve(['v7', 'v8']),
      queue,
    });
    expect(await requeue(NOW)).toBe(2);
    expect(queue.enqueueProcessing).toHaveBeenCalledWith('v7');
    expect(queue.enqueueProcessing).toHaveBeenCalledWith('v8');
  });
});
