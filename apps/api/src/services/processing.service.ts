import { MAX_UPLOAD_BYTES } from '@orghive/shared';
import { type Cache, invalidateDocuments } from '#src/lib/cache';
import type { VirusScanner } from '#src/lib/clamav';
import type { JobQueue } from '#src/lib/queue';
import type { Storage } from '#src/lib/storage';
import type { Logger } from '#src/logger';
import type { AppealRepository } from '#src/repositories/appeal.repository';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { DocumentRepository, ProcessingRecord } from '#src/repositories/document.repository';
import type { UploadIntentRepository } from '#src/repositories/upload-intent.repository';
import type { NotificationService } from './notification.service';

/** Told to the uploader only, like the file itself before its scan passes (DOMAIN_RULES.md). */
type QuarantineNotifier = Pick<NotificationService, 'notify'>;

const REFUSAL_TEXT: Record<'infected' | 'invalid', string> = {
  infected: 'the virus scan found something harmful in it',
  invalid: 'its content does not match its file type',
};

/**
 * Where a scanned upload lives: uploads/<org>/<uuid> -> files/<org>/<uuid>. The upload's
 * pre-signed PUT URL stays valid for minutes after the scan, so the bytes scanned and served
 * are a copy no upload URL can reach; otherwise a clean file could be swapped for an
 * unscanned one.
 */
export function scannedKeyOf(uploadKey: string): string {
  if (!uploadKey.startsWith('uploads/')) throw new Error(`Not an upload key: ${uploadKey}`);
  return `files/${uploadKey.slice('uploads/'.length)}`;
}

/** files/<org>/<uuid> -> quarantine/<org>/<uuid>: outside every served prefix. */
function quarantineKeyOf(scannedKey: string): string {
  return `quarantine/${scannedKey.slice('files/'.length)}`;
}

/**
 * Copies the upload and reads the copy: everything after this works on the snapshot. On a
 * retried job the copy is simply made again; the upload stays until the verdict is saved.
 */
async function snapshot(storage: Pick<Storage, 'copy' | 'read'>, uploadKey: string) {
  const scannedKey = scannedKeyOf(uploadKey);
  await storage.copy(uploadKey, scannedKey);
  return { scannedKey, body: await storage.read(scannedKey) };
}

/** Once the verdict is saved the upload object is not needed; a leftover is never served. */
async function dropUpload(
  storage: Pick<Storage, 'delete'>,
  logger: Pick<Logger, 'warn'>,
  uploadKey: string,
) {
  try {
    await storage.delete(uploadKey);
  } catch (err) {
    logger.warn({ err, uploadKey }, 'Could not delete the upload object after processing');
  }
}

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
  storage: Pick<Storage, 'read' | 'put' | 'copy' | 'move' | 'delete'>;
  scanner: VirusScanner;
  tools: FileTools;
  audit: Pick<AuditLogRepository, 'record'>;
  cache: Pick<Cache, 'deleteMatching' | 'bump'>;
  logger: Pick<Logger, 'warn' | 'info'>;
  /** Called once a document's file is found clean (project tasks listen; see worker.ts). */
  onDocumentScanned?: (documentId: string) => Promise<void>;
  /** Tells the uploader when their file is refused. */
  notifications?: QuarantineNotifier;
  now?: () => Date;
}

export type ProcessOutcome = 'clean' | 'infected' | 'invalid' | 'skipped';

export type UploadVerdict =
  { clean: true } | { clean: false; scanStatus: 'infected' | 'invalid'; reason: string };

/**
 * The checks every uploaded file passes before anyone may open it, in order: the stored
 * size matches, ClamAV finds nothing, the magic bytes are the declared type.
 */
export async function inspectUpload(
  body: Buffer,
  declared: { sizeBytes: number; mimeType: string },
  { scanner, tools }: { scanner: VirusScanner; tools: Pick<FileTools, 'detectMimeType'> },
): Promise<UploadVerdict> {
  if (body.length !== declared.sizeBytes || body.length > MAX_UPLOAD_BYTES) {
    return {
      clean: false,
      scanStatus: 'invalid',
      reason: `Stored size ${body.length} does not match ${declared.sizeBytes}`,
    };
  }
  // Virus first: malware is reported as malware whatever type it claims to be.
  const scan = await scanner.scan(body);
  if (!scan.clean)
    return { clean: false, scanStatus: 'infected', reason: `ClamAV: ${scan.signature}` };
  const detected = await tools.detectMimeType(body);
  if (detected !== declared.mimeType) {
    return {
      clean: false,
      scanStatus: 'invalid',
      reason: `Content is ${detected ?? 'an unknown type'}, not ${declared.mimeType}`,
    };
  }
  return { clean: true };
}

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
  onDocumentScanned = () => Promise.resolve(),
  notifications,
  now = () => new Date(),
}: ProcessingServiceDeps) {
  async function refuse(
    rec: ProcessingRecord,
    scannedKey: string,
    scanStatus: 'infected' | 'invalid',
    reason: string,
  ): Promise<ProcessOutcome> {
    const quarantineKey = quarantineKeyOf(scannedKey);
    await storage.move(scannedKey, quarantineKey);
    const { quarantinedDocument } = await documents.markRefused(
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
        quarantinedDocument,
      },
    });
    await dropUpload(storage, logger, rec.storageKey);
    await invalidateDocuments(cache, rec.document.organization.slug);
    logger.warn({ versionId: rec.id, scanStatus, reason }, 'Upload refused and quarantined');
    await notifications?.notify({
      userIds: [rec.uploadedById],
      kind: 'upload_quarantined',
      title: `${rec.originalFilename} was refused`,
      body: `${rec.originalFilename} (version ${rec.version} of "${rec.document.title}") was quarantined because ${REFUSAL_TEXT[scanStatus]}. Nobody can open it. Upload a clean copy.`,
      link: `/documents/${rec.document.id}`,
      dedupeKey: `quarantined:version:${rec.id}`,
    });
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

      const { scannedKey, body } = await snapshot(storage, rec.storageKey);
      const verdict = await inspectUpload(body, rec, { scanner, tools });
      if (!verdict.clean) return refuse(rec, scannedKey, verdict.scanStatus, verdict.reason);

      const extras = await preview(rec, body);
      await documents.markClean(
        versionId,
        { storageKey: scannedKey, sha256: tools.sha256Hex(body), ...extras },
        now(),
      );
      await dropUpload(storage, logger, rec.storageKey);
      // A project task's file: its project may move on (the task is submitted).
      await onDocumentScanned(rec.document.id);
      await invalidateDocuments(cache, rec.document.organization.slug);
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

export interface AttachmentProcessingDeps {
  appeals: Pick<AppealRepository, 'findAttachment' | 'markAttachmentScanned'>;
  storage: Pick<Storage, 'read' | 'copy' | 'move' | 'delete'>;
  scanner: VirusScanner;
  tools: Pick<FileTools, 'detectMimeType'>;
  audit: Pick<AuditLogRepository, 'record'>;
  logger: Pick<Logger, 'warn' | 'info'>;
  /** Tells the uploader when their file is refused. */
  notifications?: QuarantineNotifier;
}

/**
 * The worker's checks for an appeal's supporting file: the same as for documents, without
 * previews. A refused file is moved to quarantine/ and can never be attached or opened.
 */
export function createAttachmentProcessing({
  appeals,
  storage,
  scanner,
  tools,
  audit,
  logger,
  notifications,
}: AttachmentProcessingDeps) {
  return {
    /** Idempotent: a file no longer pending is skipped. Errors throw so BullMQ retries. */
    async processAttachment(attachmentId: string): Promise<ProcessOutcome> {
      const rec = await appeals.findAttachment(attachmentId);
      if (!rec || rec.scanStatus !== 'pending') return 'skipped';

      const { scannedKey, body } = await snapshot(storage, rec.storageKey);
      const verdict = await inspectUpload(body, rec, { scanner, tools });
      if (verdict.clean) {
        await appeals.markAttachmentScanned(rec.id, 'clean', scannedKey);
        await dropUpload(storage, logger, rec.storageKey);
        logger.info({ attachmentId }, 'Appeal attachment processed');
        return 'clean';
      }
      const quarantineKey = quarantineKeyOf(scannedKey);
      await storage.move(scannedKey, quarantineKey);
      await appeals.markAttachmentScanned(rec.id, verdict.scanStatus, quarantineKey);
      await dropUpload(storage, logger, rec.storageKey);
      await audit.record({
        action: 'quarantine',
        actorId: rec.uploadedById,
        entityType: 'appeal_attachment',
        entityId: rec.id,
        organizationId: rec.organizationId,
        metadata: { scanStatus: verdict.scanStatus, reason: verdict.reason },
      });
      logger.warn({ attachmentId, scanStatus: verdict.scanStatus }, 'Appeal attachment refused');
      await notifications?.notify({
        userIds: [rec.uploadedById],
        kind: 'upload_quarantined',
        title: `${rec.originalFilename} was refused`,
        body: `Your appeal attachment ${rec.originalFilename} was quarantined because ${REFUSAL_TEXT[verdict.scanStatus]}. Remove it from the appeal and attach a clean copy.`,
        link: null,
        dedupeKey: `quarantined:attachment:${rec.id}`,
      });
      return verdict.scanStatus;
    },
  };
}
