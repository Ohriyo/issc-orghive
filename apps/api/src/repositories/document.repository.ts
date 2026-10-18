import { SNIPPET_MATCH_END, SNIPPET_MATCH_START } from '@orghive/shared';
import {
  Prisma,
  type DocumentStatus,
  type DocumentVisibility,
  type ScanStatus,
  type Semester,
} from '#src/generated/prisma/client';
import {
  visibleDocumentsWhere,
  visibleVersionsWhere,
  withoutAdmin,
  type DocumentViewer,
} from './document-visibility';
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

/** A version plus what the service needs to audit an admin download of it. */
const downloadableSelect = {
  ...versionSelect,
  document: { select: { organizationId: true, visibility: true } },
} satisfies Prisma.DocumentVersionSelect;

export type DownloadableVersion = Prisma.DocumentVersionGetPayload<{
  select: typeof downloadableSelect;
}>;

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

/** Enough of a document to link to it. */
export interface DocumentBrief {
  id: string;
  title: string;
  status: DocumentStatus;
  visibility: DocumentVisibility;
}

export interface DocumentListFilters {
  organizationId?: string;
  typeId?: string;
  academicYear?: string;
  semester?: Semester;
  status?: DocumentStatus;
  visibility?: DocumentVisibility;
  /** Full-text search over title and description. */
  search?: string;
  /** Id of the last document on the previous page (ids are UUIDv7, so they sort by time). */
  cursor?: string;
  limit?: number;
}

/** Full-text search across organizations. Filters are slugs, as the search URL carries them. */
export interface DocumentSearchFilters {
  query: string;
  collegeSlug?: string;
  organizationSlug?: string;
  typeSlug?: string;
  academicYear?: string;
  offset: number;
  limit: number;
}

/** A ranked match with `ts_headline` text, matches marked with the shared snippet markers. */
export type DocumentSearchMatch = DocumentRecord & { headline: string | null };

export interface NewVersion {
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  /** Known only after the worker has read the stored bytes. */
  sha256?: string;
  uploadedById: string;
  scanStatus?: ScanStatus;
  /** Server-generated files (the Semestral End Report) arrive already processed. */
  thumbnailKey?: string | null;
  processedAt?: Date;
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
  /** Omitted only for metadata-only documents (tests, imports); uploads always send one. */
  firstVersion?: NewVersion;
}

export interface DocumentPatch {
  typeId?: string;
  title?: string;
  description?: string | null;
  academicYear?: string;
  semester?: Semester | null;
  tags?: string[];
}

/** A document can be edited or re-uploaded in these states. */
const NOT_ARCHIVED: DocumentStatus[] = ['scanning', 'available', 'quarantined'];

/** How many full-text candidates to rank before the visibility filter narrows them. */
const SEARCH_CANDIDATES = 1000;

/** File text beyond this many characters is indexed but not scanned for a snippet. */
const HEADLINE_SOURCE_CHARS = 50_000;
const HEADLINE_OPTIONS = [
  `StartSel=${SNIPPET_MATCH_START}`,
  `StopSel=${SNIPPET_MATCH_END}`,
  'MaxWords=32',
  'MinWords=14',
  'MaxFragments=2',
  'FragmentDelimiter=" … "',
].join(', ');

/** Plain filters a search narrows candidates by. Visibility is never decided here. */
interface CandidateFilters {
  organizationId?: string;
  typeId?: string;
  academicYear?: string;
  semester?: Semester;
  status?: DocumentStatus;
  visibility?: DocumentVisibility;
  collegeSlug?: string;
  organizationSlug?: string;
  typeSlug?: string;
}

function candidateConditions(filters: CandidateFilters): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [];
  if (filters.organizationId) {
    conditions.push(Prisma.sql`d.organization_id = ${filters.organizationId}::uuid`);
  }
  if (filters.typeId) conditions.push(Prisma.sql`d.type_id = ${filters.typeId}::uuid`);
  if (filters.academicYear) {
    conditions.push(Prisma.sql`d.academic_year = ${filters.academicYear}`);
  }
  if (filters.semester) conditions.push(Prisma.sql`d.semester::text = ${filters.semester}`);
  if (filters.status) conditions.push(Prisma.sql`d.status::text = ${filters.status}`);
  if (filters.visibility) {
    conditions.push(Prisma.sql`d.visibility::text = ${filters.visibility}`);
  }
  if (filters.organizationSlug) {
    conditions.push(
      Prisma.sql`d.organization_id IN (SELECT id FROM organizations WHERE slug = ${filters.organizationSlug})`,
    );
  }
  if (filters.collegeSlug) {
    conditions.push(
      Prisma.sql`d.organization_id IN (SELECT o.id FROM organizations o JOIN colleges c ON c.id = o.college_id WHERE c.slug = ${filters.collegeSlug})`,
    );
  }
  if (filters.typeSlug) {
    conditions.push(
      Prisma.sql`d.type_id IN (SELECT id FROM document_types WHERE slug = ${filters.typeSlug})`,
    );
  }
  return conditions;
}

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
   * Ranked ids matching a search, narrowed by plain filters. The raw query only produces
   * candidate ids; documents are always loaded through the visibility filter afterwards.
   */
  async function searchCandidateIds(
    search: string,
    filters: CandidateFilters = {},
  ): Promise<string[]> {
    const conditions = [
      Prisma.sql`d.search_vector @@ websearch_to_tsquery('simple', ${search})`,
      Prisma.sql`d.deleted_at IS NULL`,
      ...candidateConditions(filters),
    ];
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT d.id FROM documents d
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY ts_rank(d.search_vector, websearch_to_tsquery('simple', ${search})) DESC, d.id DESC
      LIMIT ${SEARCH_CANDIDATES}`;
    return rows.map((row) => row.id);
  }

  /** `ts_headline` over the description and file text of documents already checked visible. */
  async function headlines(search: string, ids: string[]): Promise<Map<string, string | null>> {
    if (ids.length === 0) return new Map();
    const rows = await db.$queryRaw<{ id: string; headline: string | null }[]>`
      SELECT id, nullif(ts_headline(
        'simple',
        concat_ws(' … ', nullif(description, ''), left(content_text, ${HEADLINE_SOURCE_CHARS}::int)),
        websearch_to_tsquery('simple', ${search}),
        ${HEADLINE_OPTIONS}
      ), '') AS headline
      FROM documents WHERE id = ANY(${ids}::uuid[])`;
    return new Map(rows.map((row) => [row.id, row.headline]));
  }

  return {
    findById(viewer: DocumentViewer, id: string): Promise<DocumentRecord | null> {
      return db.document.findFirst({ where: visible(viewer, { id }), select: documentSelect });
    },

    /**
     * Which of these documents the viewer may see, with what they need to show a link to
     * each (project task files, for example). Others are left out.
     */
    async findVisibleBriefs(
      viewer: DocumentViewer,
      ids: string[],
    ): Promise<Map<string, DocumentBrief>> {
      if (ids.length === 0) return new Map();
      const rows = await db.document.findMany({
        where: visible(viewer, { id: { in: ids } }),
        select: { id: true, title: true, status: true, visibility: true },
      });
      return new Map(rows.map((row) => [row.id, row]));
    },

    /**
     * True when an admin can see this document only because they are an admin (for example
     * a private file of an organization they hold no office in). Services audit such views.
     */
    async visibleOnlyAsAdmin(viewer: DocumentViewer, id: string): Promise<boolean> {
      if (viewer.kind !== 'user' || !viewer.isAdmin) return false;
      const asMember = await db.document.count({
        where: { AND: [visibleDocumentsWhere(withoutAdmin(viewer)), { id }] },
      });
      return asMember === 0;
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
        visibility: filters.visibility,
      };

      if (filters.search?.trim()) {
        const { search, cursor: _cursor, limit: _limit, ...plain } = filters;
        const ids = await searchCandidateIds(search.trim(), plain);
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
     * Full-text search across organizations: available documents only, best matches first,
     * through the visibility filter. Snippets are built only for the visible page.
     */
    async search(
      viewer: DocumentViewer,
      filters: DocumentSearchFilters,
    ): Promise<{ items: DocumentSearchMatch[]; hasMore: boolean }> {
      const { query, offset, limit, ...plain } = filters;
      const ids = await searchCandidateIds(query, { ...plain, status: 'available' });
      if (ids.length === 0) return { items: [], hasMore: false };

      const visibleRows = await db.document.findMany({
        where: visible(viewer, { id: { in: ids } }),
        select: { id: true },
      });
      const rank = new Map(ids.map((id, i) => [id, i]));
      const ranked = visibleRows.map((row) => row.id).sort((a, b) => rank.get(a)! - rank.get(b)!);
      const pageIds = ranked.slice(offset, offset + limit);
      if (pageIds.length === 0) return { items: [], hasMore: false };

      const [records, marked] = await Promise.all([
        db.document.findMany({
          where: visible(viewer, { id: { in: pageIds } }),
          select: documentSelect,
        }),
        headlines(query, pageIds),
      ]);
      const byId = new Map(records.map((record) => [record.id, record]));
      const items = pageIds.flatMap((id) => {
        const record = byId.get(id);
        return record ? [{ ...record, headline: marked.get(id) ?? null }] : [];
      });
      return { items, hasMore: ranked.length > offset + limit };
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
     * the document is missing, not visible to the viewer or archived.
     */
    async addVersion(
      viewer: DocumentViewer,
      documentId: string,
      input: NewVersion,
    ): Promise<{ id: string; version: number } | null> {
      return db.$transaction(async (tx) => {
        const target = await tx.document.findFirst({
          where: visible(viewer, { id: documentId, status: { in: NOT_ARCHIVED } }),
          select: {
            id: true,
            status: true,
            versions: { select: { version: true }, orderBy: { version: 'desc' }, take: 1 },
          },
        });
        if (!target) return null;
        // A quarantined document has no clean file yet: with a new upload it is scanning again.
        if (target.status === 'quarantined') {
          await tx.document.update({ where: { id: documentId }, data: { status: 'scanning' } });
        }
        return tx.documentVersion.create({
          data: { ...input, documentId, version: (target.versions[0]?.version ?? 0) + 1 },
          select: { id: true, version: true },
        });
      });
    },

    /**
     * The versions of a document the viewer may see, newest first: clean ones, plus their
     * own uploads that are still being scanned or were refused.
     */
    listVersions(
      viewer: DocumentViewer,
      documentId: string,
    ): Promise<{
      organizationId: string;
      visibility: DocumentVisibility;
      currentVersionId: string | null;
      versions: VersionRecord[];
    } | null> {
      return db.document.findFirst({
        where: visible(viewer, { id: documentId }),
        select: {
          organizationId: true,
          visibility: true,
          currentVersionId: true,
          versions: {
            where: visibleVersionsWhere(viewer),
            select: versionSelect,
            orderBy: { version: 'desc' },
          },
        },
      });
    },

    /** One version, only if the viewer may see it and its document. */
    findVersion(
      viewer: DocumentViewer,
      documentId: string,
      versionId: string,
    ): Promise<DownloadableVersion | null> {
      return db.documentVersion.findFirst({
        where: {
          AND: [
            { id: versionId, documentId, document: visibleDocumentsWhere(viewer) },
            visibleVersionsWhere(viewer),
          ],
        },
        select: downloadableSelect,
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
     * The worker found the file clean. It becomes (or stays) the current version unless a
     * newer clean version already took its place, and a document that was scanning or
     * quarantined becomes available. Clean is enough: nothing is reviewed.
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
                currentVersion: { select: { version: true, scanStatus: true } },
              },
            },
          },
        });
        const doc = version.document;
        const isCurrent = doc.currentVersionId === versionId;
        const current = doc.currentVersion;
        if (!isCurrent && current?.scanStatus === 'clean' && current.version > version.version) {
          return { becameCurrent: false };
        }
        await tx.document.update({
          where: { id: doc.id },
          data: { currentVersionId: versionId, contentText: result.contentText },
        });
        await tx.document.updateMany({
          where: { id: doc.id, status: { in: ['scanning', 'quarantined'] } },
          data: { status: 'available' },
        });
        return { becameCurrent: !isCurrent };
      });
    },

    /**
     * The worker refused the file (virus, or not the type it claimed). The version now
     * points at its quarantined copy. A document without a clean current file becomes
     * quarantined; a refused re-upload of an available document leaves it on its last clean
     * version.
     */
    async markRefused(
      versionId: string,
      result: { scanStatus: 'infected' | 'invalid'; reason: string; quarantineKey: string },
      now: Date,
    ): Promise<{ quarantinedDocument: boolean }> {
      return db.$transaction(async (tx) => {
        const version = await tx.documentVersion.update({
          where: { id: versionId },
          data: {
            scanStatus: result.scanStatus,
            failureReason: result.reason,
            storageKey: result.quarantineKey,
            processedAt: now,
          },
          select: {
            document: {
              select: { id: true, currentVersion: { select: { scanStatus: true } } },
            },
          },
        });
        const doc = version.document;
        if (doc.currentVersion?.scanStatus === 'clean') return { quarantinedDocument: false };
        const { count } = await tx.document.updateMany({
          where: { id: doc.id, status: { in: ['scanning', 'quarantined'] } },
          data: { status: 'quarantined' },
        });
        return { quarantinedDocument: count === 1 };
      });
    },

    /**
     * Updates the details of a document that is not archived, checked in the same statement
     * so a concurrent archive cannot slip an edit past it. Null when missing, not visible or
     * archived.
     */
    async update(
      viewer: DocumentViewer,
      id: string,
      patch: DocumentPatch,
    ): Promise<DocumentRecord | null> {
      const { count } = await db.document.updateMany({
        where: visible(viewer, { id, status: { in: NOT_ARCHIVED } }),
        data: patch,
      });
      if (count !== 1) return null;
      return db.document.findFirst({ where: visible(viewer, { id }), select: documentSelect });
    },

    /** Who can see the document, in any state. Null when missing or not visible. */
    async setVisibility(
      viewer: DocumentViewer,
      id: string,
      visibility: DocumentVisibility,
    ): Promise<DocumentRecord | null> {
      const { count } = await db.document.updateMany({
        where: visible(viewer, { id }),
        data: { visibility },
      });
      if (count !== 1) return null;
      return db.document.findFirst({ where: visible(viewer, { id }), select: documentSelect });
    },

    /** available -> archived. False when missing, not visible or not available. */
    async archive(viewer: DocumentViewer, id: string): Promise<boolean> {
      const { count } = await db.document.updateMany({
        where: visible(viewer, { id, status: 'available' }),
        data: { status: 'archived' },
      });
      return count === 1;
    },

    /** archived -> available. False when missing, not visible or not archived. */
    async restore(viewer: DocumentViewer, id: string): Promise<boolean> {
      const { count } = await db.document.updateMany({
        where: visible(viewer, { id, status: 'archived' }),
        data: { status: 'available' },
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
