import type { Prisma } from '#src/generated/prisma/client';

/**
 * What the integrity rules read of a project task's file (docs/PROJECT_WORKFLOW_SPEC.md,
 * section 6): its current version's checks and decisions, and its newest upload (still being
 * checked, or refused). System view: callers decide who may see the result.
 */
export const integrityDocumentSelect = {
  status: true,
  deletedAt: true,
  visibility: true,
  currentVersionId: true,
  currentVersion: {
    select: {
      scanStatus: true,
      checks: { select: { kind: true, result: true, message: true } },
      integrity: {
        select: {
          legacy: true,
          checkedAt: true,
          warningsClearedAt: true,
          flaggedAt: true,
          flagReason: true,
          replacesFlagged: true,
        },
      },
    },
  },
  versions: {
    orderBy: { version: 'desc' },
    take: 1,
    select: { id: true, scanStatus: true, failureReason: true },
  },
} satisfies Prisma.DocumentSelect;

export type IntegrityDocumentRecord = Prisma.DocumentGetPayload<{
  select: typeof integrityDocumentSelect;
}>;
