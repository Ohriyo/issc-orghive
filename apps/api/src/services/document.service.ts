import { createHash } from 'node:crypto';
import {
  ErrorCode,
  type CreateDocumentRequest,
  type DocumentListQuery,
  type DocumentListResponse,
  type DocumentTypeListResponse,
  type DocumentSearchQuery,
  type DocumentStatus,
  type DocumentSummary,
  type UpdateDocumentRequest,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { type Cache, cacheKeys, PUBLIC_READ_TTL_SECONDS } from '#src/lib/cache';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { DocumentRecord, DocumentRepository } from '#src/repositories/document.repository';
import type { DocumentTypeRepository } from '#src/repositories/document-type.repository';
import { PUBLIC_VIEWER, type DocumentViewer } from '#src/repositories/document-visibility';
import type { OrganizationRepository } from '#src/repositories/organization.repository';
import type { OrgRef } from '#src/services/access.service';
import type { DocumentViewerService } from '#src/services/document-viewer.service';

/** Signed-out document lists are cached for 5 minutes under `org:{slug}:docs:{hash}`. */
export const DOCUMENT_LIST_TTL_SECONDS = 5 * 60;

/** Content may change only before review; afterwards an edit would bypass approval. */
const EDITABLE: DocumentStatus[] = ['draft', 'rejected'];
/** Visibility may change at any point before archiving. */
const VISIBILITY_EDITABLE: DocumentStatus[] = ['draft', 'pending', 'approved', 'rejected'];
const SUBMITTABLE: DocumentStatus[] = ['draft', 'rejected'];

/** The signed-in user making a change. */
export interface Actor {
  userId: string;
  ip?: string;
}

export interface DocumentServiceDeps {
  documents: Pick<
    DocumentRepository,
    'findById' | 'list' | 'create' | 'update' | 'setStatus' | 'decide' | 'softDelete'
  >;
  documentTypes: Pick<DocumentTypeRepository, 'findById' | 'list'>;
  organizations: Pick<OrganizationRepository, 'findBySlug'>;
  viewers: Pick<DocumentViewerService, 'forUser'>;
  audit: Pick<AuditLogRepository, 'record'>;
  cache: Cache;
}

export function toDocumentSummary(doc: DocumentRecord): DocumentSummary {
  const { organization, currentVersion: v } = doc;
  return {
    id: doc.id,
    title: doc.title,
    description: doc.description,
    academicYear: doc.academicYear,
    semester: doc.semester,
    status: doc.status,
    visibility: doc.visibility,
    submittedAt: doc.submittedAt?.toISOString() ?? null,
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
    },
  };
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
  audit,
  cache,
}: DocumentServiceDeps) {
  function viewerFor(userId: string | undefined): Promise<DocumentViewer> {
    return userId ? viewers.forUser(userId) : Promise.resolve(PUBLIC_VIEWER);
  }

  /** Loads a document the viewer can see and that belongs to the guarded organization. */
  async function loadInOrg(viewer: DocumentViewer, org: OrgRef, id: string) {
    const doc = await documents.findById(viewer, id);
    if (!doc || doc.organization.id !== org.id) throw AppError.notFound('Document not found');
    return doc;
  }

  async function reload(viewer: DocumentViewer, id: string): Promise<DocumentSummary> {
    const doc = await documents.findById(viewer, id);
    if (!doc) throw AppError.notFound('Document not found');
    return toDocumentSummary(doc);
  }

  async function assertTypeExists(typeId: string) {
    if (!(await documentTypes.findById(typeId))) {
      throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'typeId: Unknown document type');
    }
  }

  /** Any write to an organization's documents clears its cached lists (CLAUDE.md). */
  function invalidate(org: OrgRef) {
    return cache.deleteMatching(cacheKeys.organizationDocumentsPattern(org.slug));
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

      const load = async (): Promise<DocumentListResponse> => {
        const { items, nextCursor } = await documents.list(await viewerFor(userId), {
          organizationId: org.id,
          typeId: query.typeId,
          academicYear: query.academicYear,
          semester: query.semester,
          status: query.status,
          search: query.q,
          cursor: query.cursor,
          limit: query.limit,
        });
        return { items: items.map(toDocumentSummary), nextCursor };
      };

      if (userId) return load();
      const key = cacheKeys.organizationDocuments(org.slug, queryHash(query));
      return (await cache.getOrSet(key, DOCUMENT_LIST_TTL_SECONDS, load))!;
    },

    /**
     * Full-text search across every organization, best matches first, through the same
     * visibility filter. Not cached in Redis: queries are too varied to reuse.
     */
    async search(
      userId: string | undefined,
      query: DocumentSearchQuery,
    ): Promise<DocumentListResponse> {
      const { items } = await documents.list(await viewerFor(userId), {
        search: query.q,
        limit: query.limit ?? 10,
      });
      return { items: items.map(toDocumentSummary), nextCursor: null };
    },

    /** 404 when the document does not exist or the viewer may not see it. */
    async get(userId: string | undefined, id: string): Promise<DocumentSummary> {
      return reload(await viewerFor(userId), id);
    },

    /** Creates a metadata-only draft in `org`. */
    async create(
      actor: Actor,
      org: OrgRef,
      input: CreateDocumentRequest,
    ): Promise<DocumentSummary> {
      await assertTypeExists(input.typeId);
      const created = await documents.create({
        organizationId: org.id,
        typeId: input.typeId,
        title: input.title,
        description: input.description,
        academicYear: input.academicYear,
        semester: input.semester,
        visibility: input.visibility,
        status: 'draft',
        createdById: actor.userId,
      });
      await invalidate(org);
      return toDocumentSummary(created);
    },

    /**
     * Content edits only while draft or rejected. Changing only `visibility` is allowed
     * until the document is archived. 409 otherwise.
     */
    async update(
      actor: Actor,
      org: OrgRef,
      id: string,
      patch: UpdateDocumentRequest,
    ): Promise<DocumentSummary> {
      const viewer = await viewers.forUser(actor.userId);
      const doc = await loadInOrg(viewer, org, id);
      const visibilityOnly = Object.keys(patch).every((key) => key === 'visibility');
      const allowed = visibilityOnly ? VISIBILITY_EDITABLE : EDITABLE;
      if (!allowed.includes(doc.status)) {
        throw AppError.conflict(`A ${doc.status} document cannot be edited`);
      }
      if (patch.typeId) await assertTypeExists(patch.typeId);

      const updated = await documents.update(viewer, id, patch, allowed);
      if (!updated) throw AppError.conflict('The document changed; reload and try again');
      await invalidate(org);
      return toDocumentSummary(updated);
    },

    /** draft | rejected -> pending. The current file must have passed the virus scan. */
    async submit(actor: Actor, org: OrgRef, id: string): Promise<DocumentSummary> {
      const viewer = await viewers.forUser(actor.userId);
      const doc = await loadInOrg(viewer, org, id);
      if (!SUBMITTABLE.includes(doc.status)) {
        throw AppError.conflict(`A ${doc.status} document cannot be submitted`);
      }
      if (!doc.currentVersion) throw AppError.conflict('Upload the file before submitting');
      if (doc.currentVersion.scanStatus !== 'clean') {
        throw AppError.conflict('The file has not passed the virus scan yet');
      }
      if (!(await documents.setStatus(viewer, id, 'pending', { from: SUBMITTABLE }))) {
        throw AppError.conflict('The document changed; reload and try again');
      }
      await invalidate(org);
      return reload(viewer, id);
    },

    /** pending -> approved | rejected, recorded on the current version and audited. */
    async decide(
      actor: Actor,
      org: OrgRef,
      id: string,
      decision: 'approved' | 'rejected',
      comment?: string,
    ): Promise<DocumentSummary> {
      const viewer = await viewers.forUser(actor.userId);
      const doc = await loadInOrg(viewer, org, id);
      if (doc.status !== 'pending') {
        throw AppError.conflict(`Only pending documents can be ${decision}`);
      }
      if (!(await documents.decide(viewer, id, { decision, approverId: actor.userId, comment }))) {
        throw AppError.conflict('The document changed; reload and try again');
      }
      await audit.record({
        action: decision === 'approved' ? 'approve' : 'reject',
        actorId: actor.userId,
        entityType: 'document',
        entityId: id,
        organizationId: org.id,
        metadata: { version: doc.currentVersion?.version ?? null },
        ip: actor.ip,
      });
      await invalidate(org);
      // Not reloaded: approvers may not see a document once they reject it (visibility rule),
      // yet the decision they just made succeeded.
      return toDocumentSummary({ ...doc, status: decision, updatedAt: new Date() });
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
