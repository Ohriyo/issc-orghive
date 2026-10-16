import { MAX_UPLOAD_BYTES } from '@orghive/shared';
import { type Cache, cacheKeys } from '#src/lib/cache';
import type { VirusScanner } from '#src/lib/clamav';
import type { JobQueue } from '#src/lib/queue';
import type { Storage } from '#src/lib/storage';
import type { Logger } from '#src/logger';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { DocumentRepository, ProcessingRecord } from '#src/repositories/document.repository';
import type { UploadIntentRepository } from '#src/repositories/upload-intent.repository';

/** The content helpers the worker uses (lib/file-processing in production, fakes in tests). */
export interface FileTools {
  detectMimeType(body: Uint8Array): Promise<string | undefined>;
  sha256Hex(body: Uint8Array): string;
  pdfThumbnail(body: Uint8Array): Promise<Buffer>;
  pdfText(body: Uint8Array): Promise<string>;
  imageThumbnail(body: Uint8Array): Promise<Buffer>;
}

export interface ProcessingServiceDeps {
  documents: Pick<DocumentRepository, 'findForProcessing' | 'markClean' | 'markRefused'>;
  intents: Pick<UploadIntentRepository, 'listAbandoned' | 'deleteMany'>;
  storage: Pick<Storage, 'read' | 'put' | 'move' | 'delete'>;
  scanner: VirusScanner;
  tools: FileTools;
  audit: Pick<AuditLogRepository, 'record'>;
  cache: Pick<Cache, 'deleteMatching'>;
  logger: Pick<Logger, 'warn' | 'info'>;
  now?: () => Date;
}

export type ProcessOutcome = 'clean' | 'infected' | 'invalid' | 'skipped';

/** Abandoned uploads (URL expired, never claimed) are deleted after this grace period. */
export const ABANDONED_AFTER_MS = 60 * 60 * 1000;

/**
 * What the worker does with an uploaded version, in order: the stored size matches, ClamAV
 * finds nothing, the magic bytes are the declared type, then sha256, a page-1 preview and
 * search text. A refused file is moved to quarantine/ and never served.
 */
export function createProcessingService({
  documents,
  intents,
  storage,
  scanner,
  tools,
  audit,
  cache,
  logger,
  now = () => new Date(),
}: ProcessingServiceDeps) {
  async function refuse(
    rec: ProcessingRecord,
    scanStatus: 'infected' | 'invalid',
    reason: string,
  ): Promise<ProcessOutcome> {
    // uploads/<org>/<uuid> -> quarantine/<org>/<uuid>: outside every served prefix.
    const quarantineKey = rec.storageKey.replace(/^uploads\//, 'quarantine/');
    await storage.move(rec.storageKey, quarantineKey);
    const { rejectedDocument } = await documents.markRefused(
      rec.id,
      { scanStatus, reason, quarantineKey },
      now(),
    );
    await audit.record({
      action: 'quarantine',
      entityType: 'document_version',
      entityId: rec.id,
      organizationId: rec.document.organization.id,
      metadata: {
        documentId: rec.document.id,
        version: rec.version,
        scanStatus,
        reason,
        rejectedDocument,
      },
    });
    await cache.deleteMatching(
      cacheKeys.organizationDocumentsPattern(rec.document.organization.slug),
    );
    logger.warn({ versionId: rec.id, scanStatus, reason }, 'Upload refused and quarantined');
    return scanStatus;
  }

  /** Optional extras: a failure here never blocks a clean file. */
  async function preview(rec: ProcessingRecord, body: Buffer) {
    let thumbnailKey: string | null = null;
    let contentText: string | null = null;
    const isPdf = rec.mimeType === 'application/pdf';
    const isImage = rec.mimeType === 'image/jpeg' || rec.mimeType === 'image/png';
    try {
      if (isPdf || isImage) {
        const thumbnail = isPdf ? await tools.pdfThumbnail(body) : await tools.imageThumbnail(body);
        thumbnailKey = `thumbnails/${rec.document.id}/${rec.id}.webp`;
        await storage.put(thumbnailKey, thumbnail, 'image/webp');
      }
    } catch (err) {
      thumbnailKey = null;
      logger.warn({ err, versionId: rec.id }, 'Could not render a preview');
    }
    try {
      if (isPdf) contentText = (await tools.pdfText(body)) || null;
    } catch (err) {
      logger.warn({ err, versionId: rec.id }, 'Could not extract text');
    }
    return { thumbnailKey, contentText };
  }

  return {
    /**
     * Processes one version. Idempotent: a version no longer pending is skipped, so a
     * retried job never re-runs on a finished file. Scanner and storage errors throw so
     * BullMQ retries; the file stays pending (not downloadable) meanwhile.
     */
    async processVersion(versionId: string): Promise<ProcessOutcome> {
      const rec = await documents.findForProcessing(versionId);
      if (!rec || rec.scanStatus !== 'pending') return 'skipped';

      const body = await storage.read(rec.storageKey);
      if (body.length !== rec.sizeBytes || body.length > MAX_UPLOAD_BYTES) {
        return refuse(rec, 'invalid', `Stored size ${body.length} does not match ${rec.sizeBytes}`);
      }

      // Virus first: malware is reported as malware whatever type it claims to be.
      const scan = await scanner.scan(body);
      if (!scan.clean) return refuse(rec, 'infected', `ClamAV: ${scan.signature}`);

      const detected = await tools.detectMimeType(body);
      if (detected !== rec.mimeType) {
        return refuse(
          rec,
          'invalid',
          `Content is ${detected ?? 'an unknown type'}, not ${rec.mimeType}`,
        );
      }

      const extras = await preview(rec, body);
      await documents.markClean(versionId, { sha256: tools.sha256Hex(body), ...extras }, now());
      await cache.deleteMatching(
        cacheKeys.organizationDocumentsPattern(rec.document.organization.slug),
      );
      logger.info({ versionId }, 'Upload processed');
      return 'clean';
    },

    /** Deletes uploads whose URL expired over an hour ago without a document claiming them. */
    async sweepAbandonedUploads(): Promise<number> {
      const keys = await intents.listAbandoned(new Date(now().getTime() - ABANDONED_AFTER_MS));
      for (const key of keys) await storage.delete(key);
      await intents.deleteMany(keys);
      return keys.length;
    },
  };
}

export type ProcessingService = ReturnType<typeof createProcessingService>;

/** Re-queues versions stuck in pending (e.g. the API saved them but enqueueing failed). */
export function createPendingRequeue(deps: {
  findStalePending: (before: Date) => Promise<string[]>;
  queue: JobQueue;
}) {
  return async (before: Date): Promise<number> => {
    const ids = await deps.findStalePending(before);
    for (const id of ids) await deps.queue.enqueueProcessing(id);
    return ids.length;
  };
}
