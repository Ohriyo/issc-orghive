import type { AuditAction, DocumentStatus, Prisma } from '#src/generated/prisma/client';
import { documentSelect } from './document.repository';
import { visibleDocumentsWhere, type DocumentViewer } from './document-visibility';
import type { Db } from './prisma';

/** Audit actions the dashboard shows as an organization's activity. */
export const ACTIVITY_ACTIONS = [
  'upload',
  'approve',
  'reject',
  'quarantine',
  'archive',
  'restore',
] as const satisfies AuditAction[];
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

const rejectedSelect = {
  ...documentSelect,
  approvals: {
    where: { decision: 'rejected' },
    orderBy: { decidedAt: 'desc' },
    take: 1,
    select: { comment: true, decidedAt: true, approver: { select: { name: true } } },
  },
} satisfies Prisma.DocumentSelect;

export type RejectedRecord = Prisma.DocumentGetPayload<{ select: typeof rejectedSelect }>;

export interface ActivityRecord {
  id: string;
  action: ActivityAction;
  createdAt: Date;
  actorName: string | null;
  document: { id: string; title: string } | null;
  version: number | null;
}

function metadataField(metadata: Prisma.JsonValue | null, key: string): unknown {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata[key]
    : undefined;
}

/** The document an activity entry is about: the entity itself, or a version's document. */
function documentIdOf(entry: {
  entityType: string;
  entityId: string | null;
  metadata: Prisma.JsonValue | null;
}): string | null {
  if (entry.entityType === 'document') return entry.entityId;
  const id = metadataField(entry.metadata, 'documentId');
  return typeof id === 'string' ? id : null;
}

/**
 * Reads behind the signed-in dashboard. Document reads go through the visibility filter
 * like every other document query; the service decides which organizations to ask about.
 */
export function createDashboardRepository(db: Db) {
  function visible(viewer: DocumentViewer, ...extra: Prisma.DocumentWhereInput[]) {
    return { AND: [visibleDocumentsWhere(viewer), ...extra] };
  }

  return {
    /** Visible, non-deleted documents per organization and status. */
    async countByStatus(
      viewer: DocumentViewer,
      organizationIds: string[],
    ): Promise<Map<string, Partial<Record<DocumentStatus, number>>>> {
      const counts = new Map<string, Partial<Record<DocumentStatus, number>>>();
      if (organizationIds.length === 0) return counts;
      const rows = await db.document.groupBy({
        by: ['organizationId', 'status'],
        where: visible(viewer, { organizationId: { in: organizationIds } }),
        _count: { _all: true },
      });
      for (const row of rows) {
        const forOrg = counts.get(row.organizationId) ?? {};
        forOrg[row.status] = row._count._all;
        counts.set(row.organizationId, forOrg);
      }
      return counts;
    },

    /** Rejected documents with their latest rejection, most recently decided first. */
    async listRejected(
      viewer: DocumentViewer,
      organizationId: string,
      limit = 10,
    ): Promise<RejectedRecord[]> {
      const rows = await db.document.findMany({
        where: visible(viewer, { organizationId, status: 'rejected' }),
        orderBy: { updatedAt: 'desc' },
        take: limit,
        select: rejectedSelect,
      });
      const decided = (r: RejectedRecord) => r.approvals[0]?.decidedAt.getTime() ?? 0;
      return rows.sort((a, b) => decided(b) - decided(a));
    },

    /**
     * The organization's latest uploads and decisions, newest first. Documents are loaded
     * through the visibility filter, and entries about deleted ones are left out: they
     * only add noise. A few extra entries are read so deletions don't empty the list.
     */
    async listActivity(
      viewer: DocumentViewer,
      organizationId: string,
      limit = 10,
    ): Promise<ActivityRecord[]> {
      const entries = await db.auditLog.findMany({
        where: { organizationId, action: { in: [...ACTIVITY_ACTIONS] } },
        orderBy: { createdAt: 'desc' },
        take: limit * 3,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          metadata: true,
          createdAt: true,
          actor: { select: { name: true } },
        },
      });
      const ids = [...new Set(entries.map(documentIdOf).filter((id) => id !== null))];
      const docs = ids.length
        ? await db.document.findMany({
            where: visible(viewer, { id: { in: ids } }),
            select: { id: true, title: true },
          })
        : [];
      const titles = new Map(docs.map((d) => [d.id, d]));
      const records: ActivityRecord[] = [];
      for (const entry of entries) {
        const documentId = documentIdOf(entry);
        const document = documentId ? titles.get(documentId) : undefined;
        if (!document) continue;
        const version = metadataField(entry.metadata, 'version');
        records.push({
          id: entry.id,
          action: entry.action as ActivityAction,
          createdAt: entry.createdAt,
          actorName: entry.actor?.name ?? null,
          document,
          version: typeof version === 'number' ? version : null,
        });
        if (records.length === limit) break;
      }
      return records;
    },

    /** Pending documents in these organizations whose current file can be decided on. */
    countAwaitingReview(viewer: DocumentViewer, organizationIds: string[]): Promise<number> {
      if (organizationIds.length === 0) return Promise.resolve(0);
      return db.document.count({
        where: visible(viewer, {
          organizationId: { in: organizationIds },
          status: 'pending',
          currentVersion: { is: { scanStatus: 'clean' } },
        }),
      });
    },
  };
}

export type DashboardRepository = ReturnType<typeof createDashboardRepository>;
