import { SNIPPET_MATCH_END, SNIPPET_MATCH_START } from '@orghive/shared';
import { Prisma } from '#src/generated/prisma/client';
import type { NewDocument } from './document.repository';
import { PUBLIC_VIEWER, visibleDocumentsWhere } from './document-visibility';
import type { Db } from './prisma';

/** What readers need of an edition: its document's current version, once it is readable. */
const editionSelect = {
  academicYear: true,
  isCurrent: true,
  createdAt: true,
  document: {
    select: {
      id: true,
      currentVersion: {
        select: {
          id: true,
          scanStatus: true,
          previewStatus: true,
          pageCount: true,
          thumbnailKey: true,
          outline: true,
          pageThumbnails: true,
          createdAt: true,
        },
      },
    },
  },
} satisfies Prisma.HandbookEditionSelect;

export type EditionRecord = Prisma.HandbookEditionGetPayload<{ select: typeof editionSelect }>;

const adminSelect = {
  academicYear: true,
  isCurrent: true,
  document: {
    select: {
      id: true,
      status: true,
      currentVersionId: true,
      versions: {
        orderBy: { version: 'desc' },
        select: {
          id: true,
          version: true,
          createdAt: true,
          scanStatus: true,
          previewStatus: true,
          actingAs: true,
        },
      },
    },
  },
} satisfies Prisma.HandbookEditionSelect;

export type AdminEditionRecord = Prisma.HandbookEditionGetPayload<{ select: typeof adminSelect }>;

/** A readable edition: its document is available to everyone (public, scanned clean). */
const readable: Prisma.HandbookEditionWhereInput = {
  document: visibleDocumentsWhere(PUBLIC_VIEWER),
};

const HEADLINE_OPTIONS = [
  `StartSel=${SNIPPET_MATCH_START}`,
  `StopSel=${SNIPPET_MATCH_END}`,
  'MaxWords=28',
  'MinWords=12',
  'MaxFragments=1',
].join(', ');

/**
 * Words a reader typed, as a prefix query (`dres:* & cod:*`), so "dress cod" finds "dress
 * code" while they type. Only letters and digits reach the query; null when none are left.
 */
export function prefixQuery(text: string): string | null {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) ?? [];
  return words.length > 0 ? words.map((w) => `${w}:*`).join(' & ') : null;
}

/** The Student Handbook's editions. Public reads only ever see readable ones. */
export function createHandbookRepository(db: Db) {
  return {
    /**
     * Every readable edition, newest year first (years sort as text: "2026-2027"). The public
     * reads (current, by year, the list, search) all come from this one list.
     */
    listReadable(): Promise<EditionRecord[]> {
      return db.handbookEdition.findMany({
        where: readable,
        orderBy: { academicYear: 'desc' },
        select: editionSelect,
      });
    },

    /** Every edition in any state, with its versions (the ISSC account's view). */
    listForAdmin(): Promise<AdminEditionRecord[]> {
      return db.handbookEdition.findMany({
        orderBy: { academicYear: 'desc' },
        select: adminSelect,
      });
    },

    findAdminByYear(academicYear: string): Promise<AdminEditionRecord | null> {
      return db.handbookEdition.findUnique({ where: { academicYear }, select: adminSelect });
    },

    /**
     * A new edition: its document with the file as version 1, in one transaction. It is
     * current when no edition is yet (the first upload). Null when the year was taken by a
     * concurrent upload.
     */
    async create(
      academicYear: string,
      input: NewDocument,
    ): Promise<{ documentId: string; versionId: string; isCurrent: boolean } | null> {
      const { firstVersion, ...document } = input;
      if (!firstVersion) throw new Error('An edition is always created with its file');
      try {
        return await db.$transaction(async (tx) => {
          const created = await tx.document.create({ data: document, select: { id: true } });
          const version = await tx.documentVersion.create({
            data: { ...firstVersion, documentId: created.id, version: 1 },
            select: { id: true },
          });
          await tx.document.update({
            where: { id: created.id },
            data: { currentVersionId: version.id },
          });
          const isCurrent = (await tx.handbookEdition.count({ where: { isCurrent: true } })) === 0;
          await tx.handbookEdition.create({
            data: { academicYear, documentId: created.id, isCurrent },
          });
          return { documentId: created.id, versionId: version.id, isCurrent };
        });
      } catch (err) {
        // The year's unique index, or the one-current index, raced with another upload.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return null;
        }
        throw err;
      }
    },

    /** Makes one edition current and every other one not, in one transaction. */
    async setCurrent(academicYear: string): Promise<void> {
      await db.$transaction([
        db.handbookEdition.updateMany({
          where: { isCurrent: true, NOT: { academicYear } },
          data: { isCurrent: false },
        }),
        db.handbookEdition.update({ where: { academicYear }, data: { isCurrent: true } }),
      ]);
    },

    /**
     * The pages of one version that match, best first, with the matched words marked
     * (SNIPPET_MATCH_*). The caller passes a version it read through the visibility filter.
     */
    async searchPages(
      versionId: string,
      text: string,
      limit: number,
    ): Promise<{ page: number; headline: string }[]> {
      const query = prefixQuery(text);
      if (!query) return [];
      return db.$queryRaw<{ page: number; headline: string }[]>`
        SELECT page, ts_headline('simple', text, to_tsquery('simple', ${query}), ${HEADLINE_OPTIONS}) AS headline
        FROM document_page_texts
        WHERE version_id = ${versionId}::uuid AND search_vector @@ to_tsquery('simple', ${query})
        ORDER BY ts_rank(search_vector, to_tsquery('simple', ${query})) DESC, page ASC
        LIMIT ${limit}`;
    },
  };
}

export type HandbookRepository = ReturnType<typeof createHandbookRepository>;
