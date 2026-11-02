import type { Prisma } from '#src/generated/prisma/client';
import { RANKED_VISIBILITIES } from '@orghive/shared';
import { visibleDocumentsWhere, type DocumentViewer } from './document-visibility';
import { integrityDocumentSelect } from './integrity-select';
import type { Db } from './prisma';

const projectBriefSelect = {
  id: true,
  name: true,
  targetDate: true,
  deletedAt: true,
} satisfies Prisma.ProjectSelect;

/** A task file as its governing bodies decide on it (spec section 6). */
const decisionSelect = {
  ...integrityDocumentSelect,
  id: true,
  title: true,
  organization: {
    select: { id: true, type: true, parentId: true, slug: true, acronym: true },
  },
  projectTask: { select: { type: true, project: { select: projectBriefSelect } } },
  taskFile: {
    select: {
      label: true,
      task: { select: { type: true, project: { select: projectBriefSelect } } },
    },
  },
} satisfies Prisma.DocumentSelect;

export type DecisionRecord = Prisma.DocumentGetPayload<{ select: typeof decisionSelect }>;

/** The document is a checklist file: a task's one file, or a multi-file task's file. */
const isTaskFile: Prisma.DocumentWhereInput = {
  OR: [{ projectTask: { isNot: null } }, { taskFile: { isNot: null } }],
};

/** Projects with a target date in [start, end] (Manila days). */
const inRange = (start: string, end: string): Prisma.ProjectWhereInput => ({
  deletedAt: null,
  targetDate: { gte: new Date(`${start}T00:00:00Z`), lte: new Date(`${end}T00:00:00Z`) },
});

/**
 * Governing bodies clearing a task file's warnings or flagging it invalid. Every read goes
 * through the visibility rule: a private file is never found, whoever asks.
 */
export function createTaskFileDecisionRepository(db: Db) {
  return {
    /** A task file the viewer may see, or null. */
    findForDecision(documentId: string, viewer: DocumentViewer): Promise<DecisionRecord | null> {
      return db.document.findFirst({
        where: { AND: [visibleDocumentsWhere(viewer), { id: documentId }, isTaskFile] },
        select: decisionSelect,
      });
    },

    /**
     * Task files of these organizations' projects in [start, end] that the viewer may see,
     * shared with the governing bodies or the public, whose current version warns or was
     * flagged. The rules decide which of them still need attention.
     */
    attentionCandidates(
      viewer: DocumentViewer,
      orgIds: string[],
      start: string,
      end: string,
    ): Promise<DecisionRecord[]> {
      const project = inRange(start, end);
      return db.document.findMany({
        where: {
          AND: [
            visibleDocumentsWhere(viewer),
            { organizationId: { in: orgIds }, visibility: { in: [...RANKED_VISIBILITIES] } },
            {
              OR: [{ projectTask: { project } }, { taskFile: { task: { project } } }],
            },
            {
              currentVersion: {
                OR: [
                  { integrity: { flaggedAt: { not: null } } },
                  { checks: { some: { result: 'warn' } } },
                ],
              },
            },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: decisionSelect,
      });
    },

    /** Clears the version's warnings; false when they were already cleared, or it was flagged. */
    async clearWarnings(
      versionId: string,
      decision: { byId: string; actingAs: string; note: string | null; at: Date },
    ): Promise<boolean> {
      const { count } = await db.versionIntegrity.updateMany({
        where: { versionId, warningsClearedAt: null, flaggedAt: null },
        data: {
          warningsClearedAt: decision.at,
          warningsClearedById: decision.byId,
          warningsClearedActingAs: decision.actingAs,
          warningsClearedNote: decision.note,
        },
      });
      return count === 1;
    },

    /** Flags the version invalid; false when it already was. */
    async flag(
      versionId: string,
      decision: { byId: string; actingAs: string; reason: string; at: Date },
    ): Promise<boolean> {
      const { count } = await db.versionIntegrity.updateMany({
        where: { versionId, flaggedAt: null },
        data: {
          flaggedAt: decision.at,
          flaggedById: decision.byId,
          flaggedActingAs: decision.actingAs,
          flagReason: decision.reason,
        },
      });
      return count === 1;
    },
  };
}

export type TaskFileDecisionRepository = ReturnType<typeof createTaskFileDecisionRepository>;
