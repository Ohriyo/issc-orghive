import { createHash } from 'node:crypto';
import {
  ErrorCode,
  HANDBOOK_DOCUMENT_TYPE,
  HANDBOOK_SEARCH_LIMIT,
  handbookTitle,
  parseSnippet,
  trimSnippetLead,
  type AdminHandbookResponse,
  type HandbookEdition,
  type HandbookEditionList,
  type HandbookOutlineItem,
  type HandbookPageMatch,
  type HandbookResponse,
  type HandbookSearchResponse,
  type UploadHandbookRequest,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { type Cache, invalidateDocuments, PUBLIC_READ_TTL_SECONDS } from '#src/lib/cache';
import type { JobQueue } from '#src/lib/queue';
import type { Storage } from '#src/lib/storage';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { DocumentRepository } from '#src/repositories/document.repository';
import type { DocumentTypeRepository } from '#src/repositories/document-type.repository';
import type { EditionRecord, HandbookRepository } from '#src/repositories/handbook.repository';
import type { OrganizationRepository } from '#src/repositories/organization.repository';
import type { DocumentViewerService } from '#src/services/document-viewer.service';
import type { Actor } from '#src/services/document.service';
import { THUMBNAIL_URL_TTL_SECONDS } from '#src/services/document.service';
import { handbookFileRefusal, makeCurrentRefusal, uploadPlan } from '#src/services/handbook-rules';
import type { UploadService } from '#src/services/upload.service';

export interface HandbookServiceDeps {
  handbooks: HandbookRepository;
  documents: Pick<DocumentRepository, 'addVersion'>;
  documentTypes: Pick<DocumentTypeRepository, 'findBySlug'>;
  organizations: Pick<OrganizationRepository, 'listByType'>;
  viewers: Pick<DocumentViewerService, 'forUser'>;
  uploads: Pick<UploadService, 'claim'>;
  queue: JobQueue;
  storage: Pick<Storage, 'presignGet' | 'delete'>;
  audit: Pick<AuditLogRepository, 'record'>;
  cache: Cache;
}

/** An edition as cached: the cover as a storage key, signed only when served. */
type StoredEdition = Omit<HandbookEdition, 'coverUrl'> & { coverKey: string | null };

const invalid = (message: string) => new AppError(400, ErrorCode.VALIDATION_ERROR, message);

/**
 * The cache keys sit under the ISSC's `org:{slug}:docs:*`, which every document write and the
 * worker (scan, previews) already clear: a new version shows up without extra plumbing.
 */
const keys = (isscSlug: string) => ({
  current: `org:${isscSlug}:docs:handbook:current`,
  editions: `org:${isscSlug}:docs:handbook:editions`,
  year: (year: string) => `org:${isscSlug}:docs:handbook:year:${year}`,
  search: (year: string, q: string) =>
    `org:${isscSlug}:docs:handbook:search:${year}:${createHash('sha256').update(q).digest('hex').slice(0, 24)}`,
});

function toStored(rec: EditionRecord): StoredEdition | null {
  const v = rec.document.currentVersion;
  if (!v) return null;
  const outline = Array.isArray(v.outline) ? (v.outline as unknown as HandbookOutlineItem[]) : null;
  return {
    academicYear: rec.academicYear,
    isCurrent: rec.isCurrent,
    pageCount: v.previewStatus === 'ready' ? v.pageCount : null,
    documentId: rec.document.id,
    versionId: v.id,
    previewStatus: v.previewStatus,
    outline: outline && outline.length > 0 ? outline : null,
    thumbnails: v.pageThumbnails,
    publishedAt: v.createdAt.toISOString(),
    // Only the watermarked thumbnail the preview job made.
    coverKey: v.previewStatus === 'ready' ? v.thumbnailKey : null,
  };
}

/**
 * The Student Handbook (docs/DOMAIN_RULES.md): the ISSC account uploads one PDF per academic
 * year (new versions of a year replace what readers see once scanned) and chooses the
 * current edition; everyone reads it through the watermarked viewer. Only the ISSC account
 * downloads the file (the document routes' owner rule). Editions are never removed.
 */
export function createHandbookService({
  handbooks,
  documents,
  documentTypes,
  organizations,
  viewers,
  uploads,
  queue,
  storage,
  audit,
  cache,
}: HandbookServiceDeps) {
  async function issc() {
    const [org] = await organizations.listByType('ISSC');
    if (!org) throw new Error('The ISSC organization is missing; run the seed');
    return org;
  }

  async function sign(key: string | null): Promise<string | null> {
    if (!key) return null;
    return storage.presignGet(
      key,
      { filename: 'handbook-cover.webp', contentType: 'image/webp', disposition: 'inline' },
      THUMBNAIL_URL_TTL_SECONDS,
    );
  }

  async function present(stored: StoredEdition | null): Promise<HandbookResponse> {
    if (!stored) return { edition: null };
    const { coverKey, ...edition } = stored;
    return { edition: { ...edition, coverUrl: await sign(coverKey) } };
  }

  /** A readable edition by year, or the current one (null); 404 when there is none. */
  async function readableVersion(year: string | null): Promise<StoredEdition> {
    const rec = year === null ? await handbooks.findCurrent() : await handbooks.findByYear(year);
    const stored = rec ? toStored(rec) : null;
    if (!stored) throw AppError.notFound('There is no Student Handbook for that year');
    return stored;
  }

  async function matchesIn(
    stored: StoredEdition,
    q: string,
    limit: number,
  ): Promise<HandbookPageMatch[]> {
    const rows = await handbooks.searchPages(stored.versionId, q, limit);
    return rows.map((row) => ({ page: row.page, snippet: trimSnippetLead(parseSnippet(row.headline)) }));
  }

  return {
    /** The current edition, or null before one is readable. Cached; the cover signed per call. */
    async current(): Promise<HandbookResponse> {
      const k = keys((await issc()).slug);
      const stored = await cache.getOrSet(k.current, PUBLIC_READ_TTL_SECONDS, async () => {
        const rec = await handbooks.findCurrent();
        return { stored: rec ? toStored(rec) : null };
      });
      return present(stored?.stored ?? null);
    },

    /** One academic year's edition. 404 when it has none readers can open. */
    async byYear(year: string): Promise<HandbookResponse> {
      const k = keys((await issc()).slug);
      const stored = await cache.getOrSet(k.year(year), PUBLIC_READ_TTL_SECONDS, async () => {
        const rec = await handbooks.findByYear(year);
        return rec ? toStored(rec) : null;
      });
      if (!stored) throw AppError.notFound('There is no Student Handbook for that year');
      return present(stored);
    },

    /** Every edition readers can open, newest year first. */
    async editions(): Promise<HandbookEditionList> {
      const k = keys((await issc()).slug);
      const stored = await cache.getOrSet(k.editions, PUBLIC_READ_TTL_SECONDS, async () =>
        (await handbooks.listReadable()).map(toStored).filter((e) => e !== null),
      );
      return {
        editions: await Promise.all(
          (stored ?? []).map(async (e) => ({
            academicYear: e.academicYear,
            isCurrent: e.isCurrent,
            pageCount: e.pageCount,
            coverUrl: await sign(e.coverKey),
          })),
        ),
      };
    },

    /** The pages of an edition (null: the current one) that match, best first. 404 when none. */
    async search(year: string | null, q: string): Promise<HandbookSearchResponse> {
      const k = keys((await issc()).slug);
      const stored = await readableVersion(year);
      const matches = await cache.getOrSet(
        k.search(stored.academicYear, q.toLowerCase()),
        PUBLIC_READ_TTL_SECONDS,
        () => matchesIn(stored, q, HANDBOOK_SEARCH_LIMIT),
      );
      return { query: q, matches: matches ?? [] };
    },

    /**
     * For the site search: the current edition's best matching pages, or null when there is
     * no current edition or nothing matches. The site search caches its own results.
     */
    async siteMatches(
      q: string,
      limit: number,
    ): Promise<{ academicYear: string; matches: HandbookPageMatch[] } | null> {
      const rec = await handbooks.findCurrent();
      const stored = rec ? toStored(rec) : null;
      if (!stored) return null;
      const matches = await matchesIn(stored, q, limit);
      return matches.length > 0 ? { academicYear: stored.academicYear, matches } : null;
    },

    /** Every edition in any state, with versions and who uploaded each (the ISSC account). */
    async adminList(): Promise<AdminHandbookResponse> {
      const rows = await handbooks.listForAdmin();
      return {
        editions: rows.map((row) => ({
          academicYear: row.academicYear,
          isCurrent: row.isCurrent,
          documentId: row.document.id,
          readable: row.document.status === 'available',
          versions: row.document.versions.map((v) => ({
            id: v.id,
            version: v.version,
            uploadedAt: v.createdAt.toISOString(),
            scanStatus: v.scanStatus,
            previewStatus: v.previewStatus,
            isCurrent: v.id === row.document.currentVersionId,
            actingAs: v.actingAs,
          })),
        })),
      };
    },

    /**
     * A PDF for an academic year: the year's first edition (current when it is the very
     * first), or its next version. Queued for the scan like any upload; audited.
     */
    async upload(actor: Actor, input: UploadHandbookRequest): Promise<AdminHandbookResponse> {
      const org = await issc();
      const orgRef = { id: org.id, slug: org.slug };
      const existing = await handbooks.findAdminByYear(input.academicYear);
      const file = await uploads.claim(actor.userId, orgRef, input.uploadKey);
      const refusal = handbookFileRefusal(file.mimeType);
      if (refusal) {
        await storage.delete(file.storageKey);
        throw invalid(refusal);
      }
      const newVersion = { ...file, uploadedById: actor.userId, actingAs: input.actingAs };

      let documentId: string;
      let versionId: string;
      let version: number;
      if (uploadPlan(existing) === 'new-edition') {
        const type = await documentTypes.findBySlug(HANDBOOK_DOCUMENT_TYPE.slug);
        if (!type) {
          throw new Error(`Document type ${HANDBOOK_DOCUMENT_TYPE.slug} is missing; run the migrations`);
        }
        const created = await handbooks.create(input.academicYear, {
          organizationId: org.id,
          typeId: type.id,
          title: handbookTitle(input.academicYear),
          academicYear: input.academicYear,
          status: 'scanning',
          visibility: 'public',
          createdById: actor.userId,
          firstVersion: newVersion,
        });
        if (!created) throw AppError.conflict('Another upload just changed the handbook. Reload and try again.');
        ({ documentId, versionId } = created);
        version = 1;
      } else {
        documentId = existing!.document.id;
        const added = await documents.addVersion(
          await viewers.forUser(actor.userId),
          documentId,
          newVersion,
        );
        if (!added) throw AppError.notFound('Edition not found');
        ({ id: versionId, version } = added);
      }

      await audit.record({
        action: 'upload',
        actorId: actor.userId,
        entityType: 'document',
        entityId: documentId,
        organizationId: org.id,
        metadata: { handbook: true, academicYear: input.academicYear, version },
        ip: actor.ip,
        actingAs: input.actingAs,
      });
      await queue.enqueueProcessing(versionId);
      await invalidateDocuments(cache, org.slug);
      return this.adminList();
    },

    /** Makes an edition current (the others become past editions). Audited. */
    async makeCurrent(actor: Actor, year: string, actingAs: string): Promise<AdminHandbookResponse> {
      const org = await issc();
      const row = await handbooks.findAdminByYear(year);
      const refusal = makeCurrentRefusal(
        row ? { readable: row.document.status === 'available', isCurrent: row.isCurrent } : null,
      );
      if (refusal) throw row ? AppError.conflict(refusal) : AppError.notFound(refusal);
      if (!row!.isCurrent) {
        await handbooks.setCurrent(year);
        await audit.record({
          action: 'handbook_current',
          actorId: actor.userId,
          entityType: 'document',
          entityId: row!.document.id,
          organizationId: org.id,
          metadata: { academicYear: year },
          ip: actor.ip,
          actingAs,
        });
        await invalidateDocuments(cache, org.slug);
      }
      return this.adminList();
    },
  };
}

export type HandbookService = ReturnType<typeof createHandbookService>;
