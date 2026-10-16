import type {
  ApprovalDecision,
  DocumentStatus,
  DocumentVisibility,
  Prisma,
  ScanStatus,
  Semester,
} from '#src/generated/prisma/client';
import { visibleDocumentsWhere, type DocumentViewer } from './document-visibility';
import type { Db } from './prisma';

export const documentSelect = {
  id: true,
  title: true,
  description: true,
  academicYear: true,
  semester: true,
  status: true,
  visibility: true,
  tags: true,
  submittedAt: true,
  createdAt: true,
  updatedAt: true,
  organization: { select: { id: true, slug: true, acronym: true, name: true, type: true } },
  type: { select: { id: true, slug: true, name: true } },
  currentVersion: {
    select: {
      id: true,
      version: true,
      originalFilename: true,
      mimeType: true,
      sizeBytes: true,
      scanStatus: true,
      thumbnailKey: true,
      createdAt: true,
    },
  },
} satisfies Prisma.DocumentSelect;

const versionSelect = {
  id: true,
  version: true,
  originalFilename: true,
  mimeType: true,
  sizeBytes: true,
  scanStatus: true,
  storageKey: true,
  createdAt: true,
} satisfies Prisma.DocumentVersionSelect;

export type VersionRecord = Prisma.DocumentVersionGetPayload<{ select: typeof versionSelect }>;

/** What the worker needs to process one version. */
const processingSelect = {
  id: true,
  version: true,
  storageKey: true,
  mimeType: true,
  sizeBytes: true,
  scanStatus: true,
  document: {
    select: {
      id: true,
      status: true,
      currentVersionId: true,
      organization: { select: { id: true, slug: true } },
    },
  },
} satisfies Prisma.DocumentVersionSelect;

export type ProcessingRecord = Prisma.DocumentVersionGetPayload<{
  select: typeof processingSelect;
}>;

export type DocumentRecord = Prisma.DocumentGetPayload<{ select: typeof documentSelect }>;

export interface DocumentListFilters {
  organizationId?: string;
  typeId?: string;
  academicYear?: string;
  semester?: Semester;
  status?: DocumentStatus;
  /** Full-text search over title and description. */
  search?: string;
  /** Id of the last document on the previous page (ids are UUIDv7, so they sort by time). */
  cursor?: string;
  limit?: number;
}

export interface NewVersion {
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  /** Known only after the worker has read the stored bytes. */
  sha256?: string;
  uploadedById: string;
  scanStatus?: ScanStatus;
}

export interface NewDocument {
  organizationId: string;
  typeId: string;
  title: string;
  description?: string;
  academicYear: string;
  semester?: Semester;
  status?: DocumentStatus;
  visibility?: DocumentVisibility;
  tags?: string[];
  createdById: string;
  submittedAt?: Date;
  /** Omitted only for metadata-only documents (tests, imports); uploads always send one. */
  firstVersion?: NewVersion;
}

export interface DocumentPatch {
  typeId?: string;
  title?: string;
  description?: string | null;
  academicYear?: string;
  semester?: Semester | null;
  visibility?: DocumentVisibility;
  tags?: string[];
}

export interface NewDecision {
  decision: ApprovalDecision;
  approverId: string;
  comment?: string;
}

/** How many full-text candidates to rank before the visibility filter narrows them. */
const SEARCH_CANDIDATES = 200;

/**
 * Every read or update of an existing document takes a viewer and goes through
 * `visibleDocumentsWhere`, so no caller can forget the visibility filter. Creating a
 * document is authorized by the service before it gets here.
 */
export function createDocumentRepository(db: Db) {
  function visible(viewer: DocumentViewer, ...extra: Prisma.DocumentWhereInput[]) {
    return { AND: [visibleDocumentsWhere(viewer), ...extra] };
  }

  /**
   * Ranked ids matching a search. The raw query only produces candidate ids; documents
   * are always loaded through the visibility filter afterwards.
   */
  async function searchCandidateIds(search: string): Promise<string[]> {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM documents
      WHERE search_vector @@ websearch_to_tsquery('simple', ${search})
      ORDER BY ts_rank(search_vector, websearch_to_tsquery('simple', ${search})) DESC, id DESC
      LIMIT ${SEARCH_CANDIDATES}`;
    return rows.map((row) => row.id);
  }

  return {
    findById(viewer: DocumentViewer, id: string): Promise<DocumentRecord | null> {
      return db.document.findFirst({ where: visible(viewer, { id }), select: documentSelect });
    },

    /**
     * Newest first. With `search`, results come in relevance order and only the best
     * `limit` matches are returned (no further pages).
     */
    async list(
      viewer: DocumentViewer,
      filters: DocumentListFilters = {},
    ): Promise<{ items: DocumentRecord[]; nextCursor: string | null }> {
      const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
      const exact: Prisma.DocumentWhereInput = {
        organizationId: filters.organizationId,
        typeId: filters.typeId,
        academicYear: filters.academicYear,
        semester: filters.semester,
        status: filters.status,
      };

      if (filters.search?.trim()) {
        const ids = await searchCandidateIds(filters.search.trim());
        if (ids.length === 0) return { items: [], nextCursor: null };
        const found = await db.document.findMany({
          where: visible(viewer, exact, { id: { in: ids } }),
          select: documentSelect,
        });
        const rank = new Map(ids.map((id, i) => [id, i]));
        found.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
        return { items: found.slice(0, limit), nextCursor: null };
      }

      const items = await db.document.findMany({
        where: visible(viewer, exact, filters.cursor ? { id: { lt: filters.cursor } } : {}),
        orderBy: { id: 'desc' },
        take: limit + 1,
        select: documentSelect,
      });
      const hasMore = items.length > limit;
      const page = hasMore ? items.slice(0, limit) : items;
      return { items: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
    },

    /**
     * The organization a document belongs to, for authorization before the document is
     * loaded. Deliberately skips the visibility filter: it returns no document content,
     * only which organization's roles to check. Deleted documents resolve to null.
     */
    async organizationOf(id: string): Promise<{ id: string; slug: string } | null> {
      const row = await db.document.findFirst({
        where: { id, deletedAt: null, organization: { deletedAt: null } },
        select: { organization: { select: { id: true, slug: true } } },
      });
      return row?.organization ?? null;
    },

    /** Creates the document, and its version 1 when a file is given, together. */
    async create(input: NewDocument): Promise<DocumentRecord> {
      const { firstVersion, ...document } = input;
      if (!firstVersion) return db.document.create({ data: document, select: documentSelect });
      return db.$transaction(async (tx) => {
        const created = await tx.document.create({ data: document, select: { id: true } });
        const version = await tx.documentVersion.create({
          data: { ...firstVersion, documentId: created.id, version: 1 },
          select: { id: true },
        });
        return tx.document.update({
          where: { id: created.id },
          data: { currentVersionId: version.id },
          select: documentSelect,
        });
      });
    },

    /**
     * Adds the next version, not yet current: a re-upload replaces what readers see only
     * once the worker has found it clean (markClean). Files are never overwritten. Null when
     * the document is missing or not visible to the viewer.
     */
    async addVersion(
      viewer: DocumentViewer,
      documentId: string,
      input: NewVersion,
    ): Promise<{ id: string; version: number } | null> {
      return db.$transaction(async (tx) => {
        const target = await tx.document.findFirst({
          where: visible(viewer, { id: documentId }),
          select: {
            id: true,
            versions: { select: { version: true }, orderBy: { version: 'desc' }, take: 1 },
          },
        });
        if (!target) return null;
        return tx.documentVersion.create({
          data: { ...input, documentId, version: (target.versions[0]?.version ?? 0) + 1 },
          select: { id: true, version: true },
        });
      });
    },

    /** Every version of a document the viewer may see, newest first. */
    listVersions(
      viewer: DocumentViewer,
      documentId: string,
    ): Promise<{
      organizationId: string;
      currentVersionId: string | null;
      versions: VersionRecord[];
    } | null> {
      return db.document.findFirst({
        where: visible(viewer, { id: documentId }),
        select: {
          organizationId: true,
          currentVersionId: true,
          versions: { select: versionSelect, orderBy: { version: 'desc' } },
        },
      });
    },

    /** One version, only if its document is visible to the viewer. */
    findVersion(
      viewer: DocumentViewer,
      documentId: string,
      versionId: string,
    ): Promise<VersionRecord | null> {
      return db.documentVersion.findFirst({
        where: { id: versionId, documentId, document: visibleDocumentsWhere(viewer) },
        select: versionSelect,
      });
    },

    /** Versions still pending since before `before`: their job was lost or never queued. */
    async findStalePending(before: Date, limit = 100): Promise<string[]> {
      const rows = await db.documentVersion.findMany({
        where: { scanStatus: 'pending', createdAt: { lt: before } },
        orderBy: { createdAt: 'asc' },
        take: limit,
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },

    /** For the worker: the version and its document, without a viewer (system access). */
    findForProcessing(versionId: string): Promise<ProcessingRecord | null> {
      return db.documentVersion.findUnique({ where: { id: versionId }, select: processingSelect });
    },

    /**
     * The worker found the file clean. Version 1 (already current) gets its search text; a
     * re-upload becomes the current version and sends the document back to review (a new
     * upload needs a new approval), unless a newer version already took its place.
     */
    async markClean(
      versionId: string,
      result: { sha256: string; thumbnailKey: string | null; contentText: string | null },
      now: Date,
    ): Promise<{ becameCurrent: boolean }> {
      return db.$transaction(async (tx) => {
        const version = await tx.documentVersion.update({
          where: { id: versionId },
          data: {
            scanStatus: 'clean',
            sha256: result.sha256,
            thumbnailKey: result.thumbnailKey,
            processedAt: now,
            failureReason: null,
          },
          select: {
            version: true,
            document: {
              select: {
                id: true,
                currentVersionId: true,
                currentVersion: { select: { version: true } },
              },
            },
          },
        });
        const doc = version.document;
        if (doc.currentVersionId === versionId) {
          await tx.document.update({
            where: { id: doc.id },
            data: { contentText: result.contentText },
          });
          return { becameCurrent: false };
        }
        if ((doc.currentVersion?.version ?? 0) > version.version) return { becameCurrent: false };
        await tx.document.update({
          where: { id: doc.id },
          data: {
            currentVersionId: versionId,
            contentText: result.contentText,
            status: 'pending',
            submittedAt: now,
          },
        });
        return { becameCurrent: true };
      });
    },

    /**
     * The worker refused the file (virus, or not the type it claimed). The version now
     * points at its quarantined copy. A refused version 1 also rejects the document; a
     * refused re-upload leaves the document on its last clean version.
     */
    async markRefused(
      versionId: string,
      result: { scanStatus: 'infected' | 'invalid'; reason: string; quarantineKey: string },
      now: Date,
    ): Promise<{ rejectedDocument: boolean }> {
      return db.$transaction(async (tx) => {
        const version = await tx.documentVersion.update({
          where: { id: versionId },
          data: {
            scanStatus: result.scanStatus,
            failureReason: result.reason,
            storageKey: result.quarantineKey,
            processedAt: now,
          },
          select: { document: { select: { id: true, currentVersionId: true } } },
        });
        if (version.document.currentVersionId !== versionId) return { rejectedDocument: false };
        await tx.document.update({
          where: { id: version.document.id },
          data: { status: 'rejected' },
        });
        return { rejectedDocument: true };
      });
    },

    /**
     * Updates metadata only while the document is in one of `inStatus`, so a concurrent
     * status change cannot slip an edit past it. Null when missing, not visible, or no
     * longer in an allowed status.
     */
    async update(
      viewer: DocumentViewer,
      id: string,
      patch: DocumentPatch,
      inStatus: DocumentStatus[],
    ): Promise<DocumentRecord | null> {
      const { count } = await db.document.updateMany({
        where: visible(viewer, { id, status: { in: inStatus } }),
        data: patch,
      });
      if (count !== 1) return null;
      return db.document.findFirst({ where: visible(viewer, { id }), select: documentSelect });
    },

    /**
     * Returns false when the document is missing, not visible to the viewer, or (with
     * `from`) not currently in one of those statuses.
     */
    async setStatus(
      viewer: DocumentViewer,
      id: string,
      status: DocumentStatus,
      { from }: { from?: DocumentStatus[] } = {},
    ): Promise<boolean> {
      const { count } = await db.document.updateMany({
        where: visible(viewer, { id, ...(from && { status: { in: from } }) }),
        data: { status, ...(status === 'pending' && { submittedAt: new Date() }) },
      });
      return count === 1;
    },

    /**
     * Moves a pending document to approved or rejected and records the decision on its
     * current version, atomically. False when it is not visible or no longer pending.
     */
    async decide(viewer: DocumentViewer, id: string, input: NewDecision): Promise<boolean> {
      return db.$transaction(async (tx) => {
        const target = await tx.document.findFirst({
          where: visible(viewer, {
            id,
            status: 'pending',
            currentVersion: { is: { scanStatus: 'clean' } },
          }),
          select: { currentVersionId: true },
        });
        if (!target) return false;
        const { count } = await tx.document.updateMany({
          where: { id, status: 'pending', currentVersionId: target.currentVersionId },
          data: { status: input.decision },
        });
        if (count !== 1) return false;
        await tx.approval.create({
          data: {
            documentId: id,
            versionId: target.currentVersionId!,
            approverId: input.approverId,
            decision: input.decision,
            comment: input.comment,
          },
        });
        return true;
      });
    },

    /**
     * approved | rejected -> archived, remembering the status it had so a restore can
     * return to it. False when the document is missing, not visible or in another status.
     */
    async archive(viewer: DocumentViewer, id: string): Promise<boolean> {
      const doc = await db.document.findFirst({
        where: visible(viewer, { id, status: { in: ['approved', 'rejected'] } }),
        select: { status: true },
      });
      if (!doc) return false;
      const { count } = await db.document.updateMany({
        where: visible(viewer, { id, status: doc.status }),
        data: { status: 'archived', archivedFromStatus: doc.status },
      });
      return count === 1;
    },

    /**
     * archived -> the status it had before. False when it is not archived, or was archived
     * before that status was recorded (nothing safe to return to).
     */
    async restore(viewer: DocumentViewer, id: string): Promise<boolean> {
      const doc = await db.document.findFirst({
        where: visible(viewer, { id, status: 'archived', archivedFromStatus: { not: null } }),
        select: { archivedFromStatus: true },
      });
      if (!doc?.archivedFromStatus) return false;
      const { count } = await db.document.updateMany({
        where: visible(viewer, { id, status: 'archived' }),
        data: { status: doc.archivedFromStatus, archivedFromStatus: null },
      });
      return count === 1;
    },

    /** Soft delete. Returns false when the document is missing or not visible. */
    async softDelete(viewer: DocumentViewer, id: string): Promise<boolean> {
      const { count } = await db.document.updateMany({
        where: visible(viewer, { id }),
        data: { deletedAt: new Date() },
      });
      return count === 1;
    },
  };
}

export type DocumentRepository = ReturnType<typeof createDocumentRepository>;
