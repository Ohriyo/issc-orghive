import type { Prisma } from '#src/generated/prisma/client';
import { type ProjectTaskType, type TaskCodeMatch } from '#src/generated/prisma/client';
import type { IntegrityCheck } from '@orghive/shared';
import type { Db } from './prisma';

/** A task (one-file, or the task of a multi-file task's file), as the checks need it. */
const checkedTaskSelect = {
  id: true,
  type: true,
  project: {
    select: {
      id: true,
      name: true,
      organization: { select: { id: true, slug: true, acronym: true } },
      figures: { select: { incomeCentavos: true, expensesCentavos: true } },
    },
  },
} satisfies Prisma.ProjectTaskSelect;

const checkSelect = {
  id: true,
  version: true,
  storageKey: true,
  mimeType: true,
  sizeBytes: true,
  sha256: true,
  scanStatus: true,
  originalFilename: true,
  uploadedById: true,
  integrity: { select: { typedCode: true } },
  document: {
    select: {
      id: true,
      title: true,
      organization: { select: { id: true, slug: true } },
      projectTask: { select: checkedTaskSelect },
      taskFile: { select: { id: true, label: true, task: { select: checkedTaskSelect } } },
      // An earlier version flagged invalid: this one counts for lateness from its own check.
      versions: { where: { integrity: { flaggedAt: { not: null } } }, select: { id: true } },
    },
  },
} satisfies Prisma.DocumentVersionSelect;

export type CheckRecord = Prisma.DocumentVersionGetPayload<{ select: typeof checkSelect }>;

/** What a check found, stored as JSON (never public). */
export type CheckDetails = Prisma.InputJsonValue;
/** How a file's code was found: its QR, or the code typed at upload. */
export type CodeMatch = TaskCodeMatch;

/** Where another task's file lives, to name it in a duplicate's message. */
export interface TaskFilePlace {
  versionId: string;
  documentId: string;
  taskType: ProjectTaskType;
  projectName: string;
  acronym: string;
}

/** Task-file versions only: the document belongs to a task or is a multi-file task's file. */
const isTaskFile = {
  OR: [{ projectTask: { isNot: null } }, { taskFile: { isNot: null } }],
} satisfies Prisma.DocumentWhereInput;

const placeSelect = {
  id: true,
  documentId: true,
  document: {
    select: {
      projectTask: {
        select: {
          type: true,
          project: { select: { name: true, organization: { select: { acronym: true } } } },
        },
      },
      taskFile: {
        select: {
          task: {
            select: {
              type: true,
              project: { select: { name: true, organization: { select: { acronym: true } } } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.DocumentVersionSelect;

function placeOf(
  v: Prisma.DocumentVersionGetPayload<{ select: typeof placeSelect }>,
): TaskFilePlace | null {
  const task = v.document.projectTask ?? v.document.taskFile?.task;
  if (!task) return null;
  return {
    versionId: v.id,
    documentId: v.documentId,
    taskType: task.type,
    projectName: task.project.name,
    acronym: task.project.organization.acronym,
  };
}

/** The integrity checks' reads and results (docs/PROJECT_WORKFLOW_SPEC.md, section 6). */
export function createIntegrityRepository(db: Db) {
  return {
    findForCheck(versionId: string): Promise<CheckRecord | null> {
      return db.documentVersion.findUnique({ where: { id: versionId }, select: checkSelect });
    },

    /**
     * Another task's file with exactly these bytes: a version that passed (or is passing) the
     * scan, of another document, of any task, project or organization.
     */
    async exactDuplicate(sha256: string, documentId: string): Promise<TaskFilePlace | null> {
      const found = await db.documentVersion.findMany({
        where: {
          sha256,
          scanStatus: { in: ['checking', 'clean'] },
          documentId: { not: documentId },
          document: { deletedAt: null, ...isTaskFile },
        },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: placeSelect,
      });
      return found[0] ? placeOf(found[0]) : null;
    },

    /**
     * Pages of other task files whose hash is at most `maxBits` from one of these, nearest
     * first, one per other version.
     */
    async nearDuplicates(
      hashes: bigint[],
      documentId: string,
      maxBits: number,
    ): Promise<(TaskFilePlace & { page: number; distance: number })[]> {
      if (hashes.length === 0) return [];
      const rows = await db.$queryRaw<{ version_id: string; page: number; distance: number }[]>`
        SELECT DISTINCT ON (h.version_id) h.version_id, h.page,
               bit_count((h.hash # q.hash)::bit(64))::int AS distance
        FROM page_hashes h
        JOIN document_versions v ON v.id = h.version_id
        JOIN documents d ON d.id = v.document_id
        CROSS JOIN unnest(${hashes}::bigint[]) AS q(hash)
        WHERE v.document_id <> ${documentId}::uuid
          AND v.scan_status = 'clean'
          AND d.deleted_at IS NULL
          AND bit_count((h.hash # q.hash)::bit(64)) <= ${maxBits}
        ORDER BY h.version_id, distance
        LIMIT 5`;
      if (rows.length === 0) return [];
      const versions = await db.documentVersion.findMany({
        where: { id: { in: rows.map((r) => r.version_id) } },
        select: placeSelect,
      });
      return rows
        .flatMap((row) => {
          const v = versions.find((x) => x.id === row.version_id);
          const place = v && placeOf(v);
          return place ? [{ ...place, page: row.page, distance: row.distance }] : [];
        })
        .sort((a, b) => a.distance - b.distance);
    },

    /** Replaces a version's checks, page hashes and code, in one transaction. */
    async saveResults(
      versionId: string,
      result: {
        checks: (IntegrityCheck & { details?: CheckDetails })[];
        /** Pages with content only: blank pages all hash alike. */
        pageHashes: { page: number; hash: bigint }[];
        taskCodeId: string | null;
        matchedBy: CodeMatch | null;
        replacesFlagged: boolean;
        checkedAt: Date;
      },
    ): Promise<void> {
      await db.$transaction([
        db.integrityCheck.deleteMany({ where: { versionId } }),
        db.integrityCheck.createMany({
          data: result.checks.map((c) => ({
            versionId,
            kind: c.kind,
            result: c.result,
            message: c.message.slice(0, 300),
            details: c.details,
          })),
        }),
        db.pageHash.deleteMany({ where: { versionId } }),
        db.pageHash.createMany({
          data: result.pageHashes.map(({ page, hash }) => ({ versionId, page, hash })),
        }),
        db.versionIntegrity.upsert({
          where: { versionId },
          create: {
            versionId,
            taskCodeId: result.taskCodeId,
            matchedBy: result.matchedBy,
            replacesFlagged: result.replacesFlagged,
            checkedAt: result.checkedAt,
          },
          update: {
            taskCodeId: result.taskCodeId,
            matchedBy: result.matchedBy,
            replacesFlagged: result.replacesFlagged,
            checkedAt: result.checkedAt,
          },
        }),
      ]);
    },

    /**
     * The totals check of a project's Financial Report as filed (its current version), with
     * what it read; null without one.
     */
    async findFinancialCheck(
      projectId: string,
    ): Promise<{ versionId: string; details: Prisma.JsonValue } | null> {
      const task = await db.projectTask.findUnique({
        where: { projectId_type: { projectId, type: 'FINANCIAL_REPORT' } },
        select: {
          document: {
            select: {
              currentVersion: {
                select: {
                  id: true,
                  checks: { where: { kind: 'financial_totals' }, select: { details: true } },
                },
              },
            },
          },
        },
      });
      const version = task?.document?.currentVersion;
      const check = version?.checks[0];
      return version && check ? { versionId: version.id, details: check.details } : null;
    },

    /** One check of a version, worked out again (the totals after a correction). */
    async updateCheck(
      versionId: string,
      kind: 'financial_totals',
      check: { result: 'pass' | 'warn' | 'fail'; message: string },
    ): Promise<void> {
      await db.integrityCheck.update({
        where: { versionId_kind: { versionId, kind } },
        data: { result: check.result, message: check.message.slice(0, 300) },
      });
    },

    /** Task files whose checks were queued before `before` and never ran (a lost job). */
    async listStuck(before: Date, max: number): Promise<string[]> {
      const rows = await db.documentVersion.findMany({
        where: { scanStatus: 'checking', processedAt: { lt: before } },
        orderBy: { processedAt: 'asc' },
        take: max,
        select: { id: true },
      });
      return rows.map((r) => r.id);
    },

    /** The short code typed at upload, kept for the version the worker is about to check. */
    async recordTypedCode(documentId: string, typedCode: string): Promise<void> {
      const latest = await db.documentVersion.findFirst({
        where: { documentId },
        orderBy: { version: 'desc' },
        select: { id: true },
      });
      if (!latest) return;
      await db.versionIntegrity.upsert({
        where: { versionId: latest.id },
        create: { versionId: latest.id, typedCode },
        update: { typedCode },
      });
    },

    /** A Communication Letter's code belongs to its file from the first time it passes. */
    async bindCode(codeId: string, taskFileId: string): Promise<void> {
      await db.taskCode.updateMany({
        where: { id: codeId, taskFileId: null },
        data: { taskFileId },
      });
    },
  };
}

export type IntegrityRepository = ReturnType<typeof createIntegrityRepository>;
