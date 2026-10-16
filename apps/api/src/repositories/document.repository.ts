import type { DocumentStatus, Prisma, ScanStatus, Semester } from '#src/generated/prisma/client';
import { visibleDocumentsWhere, type DocumentViewer } from './document-visibility';
import type { Db } from './prisma';

const documentSelect = {
  id: true,
  title: true,
  description: true,
  academicYear: true,
  semester: true,
  status: true,
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
      createdAt: true,
    },
  },
} satisfies Prisma.DocumentSelect;

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
  sha256: string;
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
  createdById: string;
  firstVersion: NewVersion;
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

    /** Creates the document and its version 1 together. */
    async create(input: NewDocument): Promise<DocumentRecord> {
      const { firstVersion, ...document } = input;
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

    /** Adds the next version and makes it current. Files are never overwritten. */
    async addVersion(
      viewer: DocumentViewer,
      documentId: string,
      input: NewVersion,
    ): Promise<DocumentRecord | null> {
      return db.$transaction(async (tx) => {
        const target = await tx.document.findFirst({
          where: visible(viewer, { id: documentId }),
          select: {
            id: true,
            versions: { select: { version: true }, orderBy: { version: 'desc' }, take: 1 },
          },
        });
        if (!target) return null;
        const version = await tx.documentVersion.create({
          data: { ...input, documentId, version: (target.versions[0]?.version ?? 0) + 1 },
          select: { id: true },
        });
        return tx.document.update({
          where: { id: documentId },
          data: { currentVersionId: version.id },
          select: documentSelect,
        });
      });
    },

    /** Returns false when the document is missing or not visible to the viewer. */
    async setStatus(viewer: DocumentViewer, id: string, status: DocumentStatus): Promise<boolean> {
      const { count } = await db.document.updateMany({
        where: visible(viewer, { id }),
        data: { status, ...(status === 'pending' && { submittedAt: new Date() }) },
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
