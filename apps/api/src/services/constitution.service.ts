import {
  academicYearOf,
  CONSTITUTION_DOCUMENT_TYPE,
  CONSTITUTION_TITLE,
  ErrorCode,
  manilaDate,
  type ConstitutionResponse,
  type ConstitutionVersion,
  type UploadConstitutionRequest,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { managedKindOf } from '#src/services/managed-document-rules';
import { type Cache, invalidateDocuments, PUBLIC_READ_TTL_SECONDS } from '#src/lib/cache';
import type { JobQueue } from '#src/lib/queue';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { DocumentRepository, VersionRecord } from '#src/repositories/document.repository';
import type { DocumentTypeRepository } from '#src/repositories/document-type.repository';
import { PUBLIC_VIEWER, type DocumentViewer } from '#src/repositories/document-visibility';
import type { OrganizationRepository } from '#src/repositories/organization.repository';
import type { OrgRef } from '#src/services/access.service';
import type { DocumentViewerService } from '#src/services/document-viewer.service';
import type { Actor, Reader } from '#src/services/document.service';
import type { UploadService } from '#src/services/upload.service';

export interface ConstitutionServiceDeps {
  organizations: Pick<OrganizationRepository, 'findBySlug'>;
  documents: Pick<DocumentRepository, 'createConstitution' | 'addVersion' | 'listVersions'>;
  documentTypes: Pick<DocumentTypeRepository, 'findBySlug'>;
  viewers: Pick<DocumentViewerService, 'forUser'>;
  uploads: Pick<UploadService, 'claim'>;
  queue: JobQueue;
  audit: Pick<AuditLogRepository, 'record'>;
  cache: Cache;
  now?: () => Date;
}

const invalid = (message: string) => new AppError(400, ErrorCode.VALIDATION_ERROR, message);

/** Under `org:{slug}:docs:*`, so every document write (and the worker) already clears it. */
export const constitutionCacheKey = (slug: string) => `org:${slug}:docs:constitution`;

/** A `@db.Date` holds midnight UTC of the Manila date it was given. */
const toDbDate = (isoDate: string) => new Date(`${isoDate}T00:00:00.000Z`);
const fromDbDate = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

/** True for the Constitution & By-laws type, which only this service creates or amends. */
export function isConstitutionType(type: { slug: string }): boolean {
  return managedKindOf(type) === 'constitution';
}

function toVersion(v: VersionRecord, currentVersionId: string | null, own: boolean) {
  return {
    id: v.id,
    version: v.version,
    amendedOn: fromDbDate(v.amendedOn),
    note: v.note,
    isCurrent: v.id === currentVersionId,
    uploadedAt: v.createdAt.toISOString(),
    scanStatus: v.scanStatus,
    previewStatus: v.previewStatus,
    actingAs: own ? v.actingAs : null,
  } satisfies ConstitutionVersion;
}

/**
 * An organization's Constitution & By-laws (docs/DOMAIN_RULES.md, "Constitution & By-laws"):
 * one document per organization, always public, viewed through the watermarked pages by
 * everyone but the owning account. Amending it uploads a new version with a note and the
 * date it was amended; older versions stay in its history. It is never archived or deleted,
 * and its visibility never changes (document.service refuses those for this type).
 */
export function createConstitutionService({
  organizations,
  documents,
  documentTypes,
  viewers,
  uploads,
  queue,
  audit,
  cache,
  now = () => new Date(),
}: ConstitutionServiceDeps) {
  function viewerFor(userId: string | undefined): Promise<DocumentViewer> {
    return userId ? viewers.forUser(userId) : Promise.resolve(PUBLIC_VIEWER);
  }

  async function read(viewer: DocumentViewer, documentId: string | null) {
    if (!documentId) return { constitution: null };
    const found = await documents.listVersions(viewer, documentId);
    // Not visible yet: version 1 is still being scanned, or it was refused.
    if (!found || found.versions.length === 0) return { constitution: null };
    const own = viewer.kind === 'account' && viewer.organizationId === found.organizationId;
    const versions = found.versions.map((v) => toVersion(v, found.currentVersionId, own));
    const current = versions.find((v) => v.isCurrent) ?? null;
    return {
      constitution: {
        documentId,
        lastAmendedOn: current?.amendedOn ?? null,
        versions,
      },
    } satisfies ConstitutionResponse;
  }

  async function loadOrg(slug: string) {
    const org = await organizations.findBySlug(slug);
    if (!org) throw AppError.notFound('Organization not found');
    return org;
  }

  return {
    /**
     * The constitution and its versions, newest first. Signed out it is cached; the owning
     * account also sees versions still being scanned (and who uploaded each).
     */
    async get(reader: Reader, slug: string): Promise<ConstitutionResponse> {
      const org = await loadOrg(slug);
      if (reader.userId) return read(await viewerFor(reader.userId), org.constitutionDocumentId);
      const cached = await cache.getOrSet(constitutionCacheKey(org.slug), PUBLIC_READ_TTL_SECONDS, () =>
        read(PUBLIC_VIEWER, org.constitutionDocumentId),
      );
      return cached ?? { constitution: null };
    },

    /**
     * Uploads the constitution (version 1, the adopted text) or an amendment (a new version,
     * with a note on what changed). Either way it goes through the scan like any upload and
     * becomes what readers see once clean. Audited with who acted for the account.
     */
    async upload(
      actor: Actor,
      orgRef: OrgRef,
      input: UploadConstitutionRequest,
    ): Promise<ConstitutionResponse> {
      const today = manilaDate(now());
      if (input.amendedOn > today) throw invalid('amendedOn: The date cannot be in the future');

      const org = await loadOrg(orgRef.slug);
      const viewer = await viewers.forUser(actor.userId);
      let documentId = org.constitutionDocumentId;
      let versionId: string;
      let version: number;

      if (!documentId) {
        const type = await documentTypes.findBySlug(CONSTITUTION_DOCUMENT_TYPE.slug);
        if (!type) {
          throw new Error(`Document type ${CONSTITUTION_DOCUMENT_TYPE.slug} is missing; run the migrations`);
        }
        const file = await uploads.claim(actor.userId, orgRef, input.uploadKey);
        const created = await documents.createConstitution({
          organizationId: org.id,
          typeId: type.id,
          title: CONSTITUTION_TITLE,
          academicYear: academicYearOf(input.amendedOn),
          status: 'scanning',
          visibility: 'public',
          createdById: actor.userId,
          firstVersion: {
            ...file,
            uploadedById: actor.userId,
            actingAs: input.actingAs,
            amendedOn: toDbDate(input.amendedOn),
            note: input.note ?? null,
          },
        });
        if (!created) throw AppError.conflict('A constitution was just uploaded; reload the page');
        documentId = created.id;
        versionId = created.currentVersion!.id;
        version = 1;
      } else {
        if (!input.note) throw invalid('note: Say what the amendment changed');
        const file = await uploads.claim(actor.userId, orgRef, input.uploadKey);
        const added = await documents.addVersion(viewer, documentId, {
          ...file,
          uploadedById: actor.userId,
          actingAs: input.actingAs,
          amendedOn: toDbDate(input.amendedOn),
          note: input.note ?? null,
        });
        if (!added) throw AppError.notFound('Constitution not found');
        versionId = added.id;
        version = added.version;
      }

      await audit.record({
        action: 'upload',
        actorId: actor.userId,
        entityType: 'document',
        entityId: documentId,
        organizationId: org.id,
        metadata: { constitution: true, version, amendedOn: input.amendedOn },
        ip: actor.ip,
        actingAs: input.actingAs,
      });
      await queue.enqueueProcessing(versionId);
      await invalidateDocuments(cache, org.slug);
      return read(viewer, documentId);
    },
  };
}

export type ConstitutionService = ReturnType<typeof createConstitutionService>;
