import { createHash } from 'node:crypto';
import {
  ErrorCode,
  type CreateDocumentRequest,
  type DocumentListQuery,
  type DocumentListResponse,
  type DocumentTypeListResponse,
  type DocumentStatus,
  type DocumentSummary,
  type DocumentVersion,
  type DocumentVersionListResponse,
  type DocumentVisibility,
  type DownloadUrlResponse,
  type UpdateDocumentRequest,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import {
  type Cache,
  cacheKeys,
  invalidateDocuments,
  PUBLIC_READ_TTL_SECONDS,
} from '#src/lib/cache';
import type { JobQueue } from '#src/lib/queue';
import type { Storage } from '#src/lib/storage';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type {
  DocumentRecord,
  DocumentRepository,
  VersionRecord,
} from '#src/repositories/document.repository';
import type { DocumentTypeRepository } from '#src/repositories/document-type.repository';
import { PUBLIC_VIEWER, type DocumentViewer } from '#src/repositories/document-visibility';
import type { OrganizationRepository } from '#src/repositories/organization.repository';
import type { OrgRef } from '#src/services/access.service';
import type { DocumentViewerService } from '#src/services/document-viewer.service';
import type { UploadService } from '#src/services/upload.service';

/** Signed-out document lists are cached for 5 minutes under `org:{slug}:docs:{hash}`. */
export const DOCUMENT_LIST_TTL_SECONDS = 5 * 60;
/** CLAUDE.md: download links expire in 5 minutes. */
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
/** Previews are signed when served (never cached signed), valid long enough to view a page. */
export const THUMBNAIL_URL_TTL_SECONDS = 15 * 60;

/** Archived documents cannot change; anything else may be edited (nothing is reviewed). */
const EDITABLE: DocumentStatus[] = ['scanning', 'available', 'quarantined'];

/** The signed-in user making a change. */
export interface Actor {
  userId: string;
  ip?: string;
}

/** Whoever is reading: signed out (no userId) or signed in. */
export interface Reader {
  userId?: string;
  ip?: string;
}

export interface DocumentServiceDeps {
  documents: Pick<
    DocumentRepository,
    | 'findById'
    | 'list'
    | 'create'
    | 'update'
    | 'setVisibility'
    | 'softDelete'
    | 'archive'
    | 'restore'
    | 'addVersion'
    | 'listVersions'
    | 'findVersion'
  >;
  documentTypes: Pick<DocumentTypeRepository, 'findById' | 'list'>;
  organizations: Pick<OrganizationRepository, 'findBySlug'>;
  viewers: Pick<DocumentViewerService, 'forUser'>;
  uploads: Pick<UploadService, 'claim'>;
  queue: JobQueue;
  storage: Pick<Storage, 'presignGet'>;
  audit: Pick<AuditLogRepository, 'record'>;
  cache: Cache;
  now?: () => Date;
}

type Version = NonNullable<DocumentSummary['currentVersion']>;

/**
 * A summary as stored in the list cache: the preview as a storage key. It is signed only
 * when served, so a cached list never hands out expired links.
 */
export type StoredSummary = Omit<DocumentSummary, 'currentVersion'> & {
  currentVersion: (Omit<Version, 'thumbnailUrl'> & { thumbnailKey: string | null }) | null;
};

export function toStoredSummary(doc: DocumentRecord): StoredSummary {
  const { organization, currentVersion: v } = doc;
  return {
    id: doc.id,
    title: doc.title,
    description: doc.description,
    academicYear: doc.academicYear,
    semester: doc.semester,
    status: doc.status,
    visibility: doc.visibility,
    tags: doc.tags,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    organization: {
      type: organization.type,
      slug: organization.slug,
      acronym: organization.acronym,
      name: organization.name,
    },
    type: doc.type,
    currentVersion: v && {
      version: v.version,
      originalFilename: v.originalFilename,
      mimeType: v.mimeType,
      sizeBytes: v.sizeBytes,
      scanStatus: v.scanStatus,
      createdAt: v.createdAt.toISOString(),
      thumbnailKey: v.thumbnailKey,
    },
  };
}

export function toDocumentVersion(
  v: VersionRecord,
  currentVersionId: string | null,
): DocumentVersion {
  return {
    id: v.id,
    version: v.version,
    originalFilename: v.originalFilename,
    mimeType: v.mimeType,
    sizeBytes: v.sizeBytes,
    scanStatus: v.scanStatus,
    createdAt: v.createdAt.toISOString(),
    isCurrent: v.id === currentVersionId,
  };
}

/**
 * Signs a stored summary's preview link, if it has one. Signing is local; no storage call.
 * Shared with the dashboard, which serves the same summaries.
 */
export async function presentSummary(
  storage: Pick<Storage, 'presignGet'>,
  stored: StoredSummary,
): Promise<DocumentSummary> {
  const v = stored.currentVersion;
  if (!v) return { ...stored, currentVersion: null };
  const { thumbnailKey, ...version } = v;
  const thumbnailUrl = thumbnailKey
    ? await storage.presignGet(
        thumbnailKey,
        { filename: 'preview.webp', contentType: 'image/webp', disposition: 'inline' },
        THUMBNAIL_URL_TTL_SECONDS,
      )
    : null;
  return { ...stored, currentVersion: { ...version, thumbnailUrl } };
}

/** Stable across key order, so equal queries share one cache entry. */
function queryHash(query: DocumentListQuery): string {
  const sorted = Object.entries(query)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 32);
}

/**
 * Paperworks business rules. Authorization (who may act on which organization) is done by
 * the route guards before these methods run; every read and write here still goes through
 * the repository's visibility filter for the acting user.
 */
export function createDocumentService({
  documents,
  documentTypes,
  organizations,
  viewers,
  uploads,
  queue,
  storage,
  audit,
  cache,
  now = () => new Date(),
}: DocumentServiceDeps) {
  function viewerFor(userId: string | undefined): Promise<DocumentViewer> {
    return userId ? viewers.forUser(userId) : Promise.resolve(PUBLIC_VIEWER);
  }

  const present = (stored: StoredSummary) => presentSummary(storage, stored);

  const summarize = (doc: DocumentRecord) => present(toStoredSummary(doc));

  /** Loads a document the viewer can see and that belongs to the guarded organization. */
  async function loadInOrg(viewer: DocumentViewer, org: OrgRef, id: string) {
    const doc = await documents.findById(viewer, id);
    if (!doc || doc.organization.id !== org.id) throw AppError.notFound('Document not found');
    return doc;
  }

  async function reload(viewer: DocumentViewer, id: string): Promise<DocumentSummary> {
    const doc = await documents.findById(viewer, id);
    if (!doc) throw AppError.notFound('Document not found');
    return summarize(doc);
  }

  async function assertTypeExists(typeId: string) {
    if (!(await documentTypes.findById(typeId))) {
      throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'typeId: Unknown document type');
    }
  }

  /** Any write to an organization's documents clears its cached lists (CLAUDE.md). */
  function invalidate(org: OrgRef) {
    return invalidateDocuments(cache, org.slug);
  }

  function auditUpload(actor: Actor, org: OrgRef, documentId: string, file: object) {
    return audit.record({
      action: 'upload',
      actorId: actor.userId,
      entityType: 'document',
      entityId: documentId,
      organizationId: org.id,
      metadata: { ...file },
      ip: actor.ip,
    });
  }

  return {
    /** Every document type, for upload forms and filters. Public, cached 10 minutes. */
    async listTypes(): Promise<DocumentTypeListResponse> {
      const types = await cache.getOrSet(cacheKeys.documentTypes(), PUBLIC_READ_TTL_SECONDS, () =>
        documentTypes.list(),
      );
      return { types: types ?? [] };
    },

    /** Throws 404 for an unknown organization. Signed-out results are cached. */
    async list(
      userId: string | undefined,
      slug: string,
      query: DocumentListQuery,
    ): Promise<DocumentListResponse> {
      const org = await organizations.findBySlug(slug);
      if (!org) throw AppError.notFound('Organization not found');

      const load = async () => {
        const { items, nextCursor } = await documents.list(await viewerFor(userId), {
          organizationId: org.id,
          typeId: query.typeId,
          academicYear: query.academicYear,
          semester: query.semester,
          status: query.status,
          visibility: query.visibility,
          search: query.q,
          cursor: query.cursor,
          limit: query.limit,
        });
        return { items: items.map(toStoredSummary), nextCursor };
      };

      const stored = userId
        ? await load()
        : (await cache.getOrSet(
            cacheKeys.organizationDocuments(org.slug, queryHash(query)),
            DOCUMENT_LIST_TTL_SECONDS,
            load,
          ))!;
      return { items: await Promise.all(stored.items.map(present)), nextCursor: stored.nextCursor };
    },

    /** 404 when the document does not exist or the viewer may not see it. */
    async get(reader: Reader, id: string): Promise<DocumentSummary> {
      const viewer = await viewerFor(reader.userId);
      const doc = await documents.findById(viewer, id);
      if (!doc) throw AppError.notFound('Document not found');
      return summarize(doc);
    },

    /**
     * Creates a document in `org` from a file already uploaded with an upload URL: version 1,
     * `scanning` (only the uploader sees it) and queued for the virus scan; the worker makes
     * it available once the file is clean. Audited as an upload.
     */
    async create(
      actor: Actor,
      org: OrgRef,
      input: CreateDocumentRequest,
    ): Promise<DocumentSummary> {
      await assertTypeExists(input.typeId);
      const file = await uploads.claim(actor.userId, org, input.uploadKey);
      const created = await documents.create({
        organizationId: org.id,
        typeId: input.typeId,
        title: input.title,
        description: input.description,
        academicYear: input.academicYear,
        semester: input.semester,
        visibility: input.visibility,
        tags: input.tags,
        status: 'scanning',
        createdById: actor.userId,
        firstVersion: { ...file, uploadedById: actor.userId },
      });
      await auditUpload(actor, org, created.id, {
        version: 1,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
      });
      await queue.enqueueProcessing(created.currentVersion!.id);
      await invalidate(org);
      return summarize(created);
    },

    /**
     * A re-upload: the next version, not current until the worker finds it clean. Nothing is
     * overwritten, and nothing needs approving again. 409 for archived documents.
     */
    async addVersion(
      actor: Actor,
      org: OrgRef,
      id: string,
      uploadKey: string,
    ): Promise<DocumentVersion> {
      const viewer = await viewers.forUser(actor.userId);
      const doc = await loadInOrg(viewer, org, id);
      if (doc.status === 'archived') throw AppError.conflict('An archived document cannot change');
      const file = await uploads.claim(actor.userId, org, uploadKey);
      const added = await documents.addVersion(viewer, id, { ...file, uploadedById: actor.userId });
      if (!added) throw AppError.notFound('Document not found');
      await auditUpload(actor, org, id, {
        version: added.version,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
      });
      await queue.enqueueProcessing(added.id);
      await invalidate(org);
      return {
        id: added.id,
        version: added.version,
        originalFilename: file.originalFilename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        scanStatus: 'pending',
        createdAt: now().toISOString(),
        isCurrent: false,
      };
    },

    /**
     * Every version the viewer may see, newest first. The repository decides which: clean
     * ones, plus the viewer's own uploads while they are scanned or after they are refused.
     */
    async listVersions(reader: Reader, id: string): Promise<DocumentVersionListResponse> {
      const viewer = await viewerFor(reader.userId);
      const found = await documents.listVersions(viewer, id);
      if (!found) throw AppError.notFound('Document not found');
      return {
        versions: found.versions.map((v) => toDocumentVersion(v, found.currentVersionId)),
      };
    },

    /**
     * A 5-minute signed link to one version (old versions stay downloadable). Only clean
     * files; 404 when the viewer may not see the document.
     */
    async downloadUrl(
      reader: Reader,
      id: string,
      versionId: string,
      disposition: 'attachment' | 'inline' = 'attachment',
    ): Promise<DownloadUrlResponse> {
      const viewer = await viewerFor(reader.userId);
      const version = await documents.findVersion(viewer, id, versionId);
      if (!version) throw AppError.notFound('Document not found');
      if (version.scanStatus !== 'clean') {
        throw AppError.conflict('This file is not available: it has not passed the virus scan');
      }
      const url = await storage.presignGet(
        version.storageKey,
        { filename: version.originalFilename, contentType: version.mimeType, disposition },
        DOWNLOAD_URL_TTL_SECONDS,
      );
      return {
        url,
        expiresAt: new Date(now().getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString(),
      };
    },

    /** Details may change at any time before archiving; 409 for an archived document. */
    async update(
      actor: Actor,
      org: OrgRef,
      id: string,
      patch: UpdateDocumentRequest,
    ): Promise<DocumentSummary> {
      const viewer = await viewers.forUser(actor.userId);
      const doc = await loadInOrg(viewer, org, id);
      if (!EDITABLE.includes(doc.status)) {
        throw AppError.conflict(`A ${doc.status} document cannot be edited`);
      }
      if (patch.typeId) await assertTypeExists(patch.typeId);

      const updated = await documents.update(viewer, id, patch);
      if (!updated) throw AppError.conflict('The document changed; reload and try again');
      await invalidate(org);
      return summarize(updated);
    },

    /**
     * Who can see the document, at any time and in any state. Only the organization's own
     * officers get here (the route refuses admins). Audited when it changes.
     */
    async setVisibility(
      actor: Actor,
      org: OrgRef,
      id: string,
      visibility: DocumentVisibility,
    ): Promise<DocumentSummary> {
      const viewer = await viewers.forUser(actor.userId);
      const doc = await loadInOrg(viewer, org, id);
      if (doc.visibility === visibility) return summarize(doc);

      const updated = await documents.setVisibility(viewer, id, visibility);
      if (!updated) throw AppError.notFound('Document not found');
      await audit.record({
        action: 'visibility_change',
        actorId: actor.userId,
        entityType: 'document',
        entityId: id,
        organizationId: org.id,
        metadata: { from: doc.visibility, to: visibility },
        ip: actor.ip,
      });
      await invalidate(org);
      return summarize(updated);
    },

    /**
     * available -> archived, audited. Archived documents leave the Paperworks (only the
     * organization's officers see them) and cannot change; restore() brings one back.
     */
    async archive(actor: Actor, org: OrgRef, id: string): Promise<DocumentSummary> {
      const viewer = await viewers.forUser(actor.userId);
      const doc = await loadInOrg(viewer, org, id);
      if (doc.status !== 'available') {
        throw AppError.conflict(`A ${doc.status} document cannot be archived`);
      }
      if (!(await documents.archive(viewer, id))) {
        throw AppError.conflict('The document changed; reload and try again');
      }
      await audit.record({
        action: 'archive',
        actorId: actor.userId,
        entityType: 'document',
        entityId: id,
        organizationId: org.id,
        ip: actor.ip,
      });
      await invalidate(org);
      return reload(viewer, id);
    },

    /** archived -> available, with the visibility it had. Audited. 409 otherwise. */
    async restore(actor: Actor, org: OrgRef, id: string): Promise<DocumentSummary> {
      const viewer = await viewers.forUser(actor.userId);
      const doc = await loadInOrg(viewer, org, id);
      if (doc.status !== 'archived') {
        throw AppError.conflict('Only archived documents can be restored');
      }
      if (!(await documents.restore(viewer, id))) {
        throw AppError.conflict('The document changed; reload and try again');
      }
      await audit.record({
        action: 'restore',
        actorId: actor.userId,
        entityType: 'document',
        entityId: id,
        organizationId: org.id,
        ip: actor.ip,
      });
      await invalidate(org);
      return reload(viewer, id);
    },

    /** Soft delete, audited. */
    async remove(actor: Actor, org: OrgRef, id: string): Promise<void> {
      const viewer = await viewers.forUser(actor.userId);
      const doc = await loadInOrg(viewer, org, id);
      if (!(await documents.softDelete(viewer, id))) throw AppError.notFound('Document not found');
      await audit.record({
        action: 'delete',
        actorId: actor.userId,
        entityType: 'document',
        entityId: id,
        organizationId: org.id,
        metadata: { status: doc.status },
        ip: actor.ip,
      });
      await invalidate(org);
    },
  };
}

export type DocumentService = ReturnType<typeof createDocumentService>;
