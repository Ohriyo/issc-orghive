import { describe, expect, it, vi } from 'vitest';
import type { ScanResult } from '#src/lib/clamav';
import type { ProcessingRecord } from '#src/repositories/document.repository';
import {
  createAttachmentProcessing,
  createPendingRequeue,
  createProcessingService,
} from '#src/services/processing.service';

const NOW = new Date('2026-10-16T00:00:00Z');
const BODY = Buffer.from('%PDF-1.7 fake but sized');

function rec(overrides: Partial<ProcessingRecord> = {}): ProcessingRecord {
  return {
    id: 'v1',
    version: 1,
    storageKey: 'uploads/org-1/k1',
    originalFilename: 'budget.pdf',
    uploadedById: 'u1',
    mimeType: 'application/pdf',
    sizeBytes: BODY.length,
    scanStatus: 'pending',
    document: {
      id: 'd1',
      status: 'scanning',
      currentVersionId: 'v1',
      title: 'Budget 2026',
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
    copy: vi.fn(() => Promise.resolve()),
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
  const notifications = { notify: vi.fn(() => Promise.resolve()) };
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
    notifications,
    now: () => NOW,
  });
  return {
    service,
    documents,
    intents,
    storage,
    scanner,
    tools,
    audit,
    cache,
    onDocumentScanned,
    notifications,
  };
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

describe('processingService: telling the uploader', () => {
  it('tells only the uploader that their file was refused, once per version', async () => {
    const { service, notifications } = setup({ scan: { clean: false, signature: 'Eicar' } });
    await service.processVersion('v1');
    expect(notifications.notify).toHaveBeenCalledWith({
      userIds: ['u1'],
      kind: 'upload_quarantined',
      title: 'budget.pdf was refused',
      body: expect.stringContaining('the virus scan found something harmful') as unknown,
      link: '/documents/d1',
      dedupeKey: 'quarantined:version:v1',
    });
  });

  it('says why when the content is not its declared type', async () => {
    const { service, notifications } = setup({ detected: 'application/zip' });
    await service.processVersion('v1');
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('does not match its file type') as unknown,
      }),
    );
  });

  it('tells nobody about a clean file', async () => {
    const { service, notifications } = setup();
    await service.processVersion('v1');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('keeps a clean appeal attachment at its scanned copy, out of reach of its upload URL', async () => {
    const markAttachmentScanned = vi.fn(() => Promise.resolve(true));
    const storage = {
      read: vi.fn(() => Promise.resolve(BODY)),
      copy: vi.fn(() => Promise.resolve()),
      move: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    };
    const attachments = createAttachmentProcessing({
      appeals: {
        findAttachment: vi.fn(() =>
          Promise.resolve({
            id: 'a1',
            organizationId: 'org-1',
            uploadedById: 'u2',
            appealId: null,
            storageKey: 'uploads/org-1/a1',
            originalFilename: 'receipt.pdf',
            mimeType: 'application/pdf',
            sizeBytes: BODY.length,
            scanStatus: 'pending' as const,
          }),
        ),
        markAttachmentScanned,
      },
      storage,
      scanner: { scan: vi.fn(() => Promise.resolve({ clean: true as const })) },
      tools: { detectMimeType: vi.fn(() => Promise.resolve('application/pdf')) },
      audit: { record: vi.fn(() => Promise.resolve()) },
      logger: { warn: vi.fn(), info: vi.fn() },
    });
    expect(await attachments.processAttachment('a1')).toBe('clean');
    expect(storage.copy).toHaveBeenCalledWith('uploads/org-1/a1', 'files/org-1/a1');
    expect(storage.read).toHaveBeenCalledWith('files/org-1/a1');
    expect(markAttachmentScanned).toHaveBeenCalledWith('a1', 'clean', 'files/org-1/a1');
    expect(storage.delete).toHaveBeenCalledWith('uploads/org-1/a1');
  });

  it("tells an appeal attachment's uploader when it is refused", async () => {
    const notifications = { notify: vi.fn(() => Promise.resolve()) };
    const attachments = createAttachmentProcessing({
      appeals: {
        findAttachment: vi.fn(() =>
          Promise.resolve({
            id: 'a1',
            organizationId: 'org-1',
            uploadedById: 'u2',
            appealId: null,
            storageKey: 'uploads/org-1/a1',
            originalFilename: 'receipt.png',
            mimeType: 'image/png',
            sizeBytes: BODY.length,
            scanStatus: 'pending' as const,
          }),
        ),
        markAttachmentScanned: vi.fn(() => Promise.resolve(true)),
      },
      storage: {
        read: vi.fn(() => Promise.resolve(BODY)),
        copy: vi.fn(() => Promise.resolve()),
        move: vi.fn(() => Promise.resolve()),
        delete: vi.fn(() => Promise.resolve()),
      },
      scanner: { scan: vi.fn(() => Promise.resolve({ clean: false, signature: 'Eicar' })) },
      tools: { detectMimeType: vi.fn(() => Promise.resolve('image/png')) },
      audit: { record: vi.fn(() => Promise.resolve()) },
      logger: { warn: vi.fn(), info: vi.fn() },
      notifications,
    });
    expect(await attachments.processAttachment('a1')).toBe('infected');
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['u2'],
        kind: 'upload_quarantined',
        dedupeKey: 'quarantined:attachment:a1',
      }),
    );
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
        storageKey: 'files/org-1/k1',
        sha256: 'f'.repeat(64),
        thumbnailKey: 'thumbnails/d1/v1.webp',
        contentText: 'truss lattice',
      },
      NOW,
    );
    expect(cache.deleteMatching).toHaveBeenCalledWith('org:jpice:docs:*');
    expect(cache.bump).toHaveBeenCalledWith('search:gen');
  });

  it('scans and serves a copy no upload URL can reach, then drops the upload', async () => {
    const { service, storage } = setup();
    await service.processVersion('v1');
    expect(storage.copy).toHaveBeenCalledWith('uploads/org-1/k1', 'files/org-1/k1');
    expect(storage.read).toHaveBeenCalledWith('files/org-1/k1');
    expect(storage.read).not.toHaveBeenCalledWith('uploads/org-1/k1');
    expect(storage.delete).toHaveBeenCalledWith('uploads/org-1/k1');
  });

  it('a second PUT to the upload URL after the scan changes nothing that is served', async () => {
    // An in-memory bucket: the attack is overwriting uploads/… while its URL is still valid.
    const bucket = new Map<string, Buffer>([['uploads/org-1/k1', BODY]]);
    const malware = Buffer.alloc(BODY.length, 0x4d);
    let served: string | undefined;
    const service = createProcessingService({
      documents: {
        findForProcessing: () => Promise.resolve(rec()),
        markClean: (_id, result) => {
          served = result.storageKey;
          return Promise.resolve({ becameCurrent: true });
        },
        markRefused: () => Promise.resolve({ quarantinedDocument: false }),
      },
      intents: { listAbandoned: () => Promise.resolve([]), deleteMany: () => Promise.resolve() },
      storage: {
        read: (key) => Promise.resolve(bucket.get(key)!),
        put: () => Promise.resolve(),
        copy: (from, to) => Promise.resolve(void bucket.set(to, bucket.get(from)!)),
        move: () => Promise.resolve(),
        delete: (key) => Promise.resolve(void bucket.delete(key)),
      },
      scanner: { scan: () => Promise.resolve({ clean: true }) },
      tools: {
        detectMimeType: () => Promise.resolve('application/pdf'),
        sha256Hex: () => 'f'.repeat(64),
        pdfThumbnail: () => Promise.resolve(Buffer.from('webp')),
        pdfText: () => Promise.resolve(''),
        imageThumbnail: () => Promise.resolve(Buffer.from('webp')),
      },
      audit: { record: () => Promise.resolve() },
      cache: { deleteMatching: () => Promise.resolve(), bump: () => Promise.resolve() },
      logger: { warn: vi.fn(), info: vi.fn() },
      now: () => NOW,
    });

    expect(await service.processVersion('v1')).toBe('clean');
    bucket.set('uploads/org-1/k1', malware); // the attacker re-PUTs with the same URL
    expect(served).toBe('files/org-1/k1');
    expect(bucket.get(served!)).toEqual(BODY);
  });

  it('quarantines an infected file and its document, and audits it', async () => {
    const { service, documents, storage, audit, tools } = setup({
      scan: { clean: false, signature: 'Eicar-Test-Signature' },
    });
    expect(await service.processVersion('v1')).toBe('infected');
    // The scanned copy is quarantined; the upload object itself is dropped.
    expect(storage.move).toHaveBeenCalledWith('files/org-1/k1', 'quarantine/org-1/k1');
    expect(storage.delete).toHaveBeenCalledWith('uploads/org-1/k1');
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
