import type {
  AuditAction,
  DocumentStatus,
  DocumentVisibility,
  Prisma,
} from '#src/generated/prisma/client';
import { documentSelect, type DocumentRecord } from './document.repository';
import { visibleDocumentsWhere, type DocumentViewer } from './document-visibility';
import type { Db } from './prisma';

/** Audit actions the dashboard shows as an organization's activity. */
export const ACTIVITY_ACTIONS = [
  'upload',
  'quarantine',
  'archive',
  'restore',
  'visibility_change',
] as const satisfies AuditAction[];
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

/** Available documents count by visibility; every other state by itself. */
export type CountBucket = DocumentVisibility | Exclude<DocumentStatus, 'available'>;

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
    /** Visible, non-deleted documents per organization, by visibility and lifecycle state. */
    async countForDashboard(
      viewer: DocumentViewer,
      organizationIds: string[],
    ): Promise<Map<string, Partial<Record<CountBucket, number>>>> {
      const counts = new Map<string, Partial<Record<CountBucket, number>>>();
      if (organizationIds.length === 0) return counts;
      const rows = await db.document.groupBy({
        by: ['organizationId', 'status', 'visibility'],
        where: visible(viewer, { organizationId: { in: organizationIds } }),
        _count: { _all: true },
      });
      for (const row of rows) {
        const forOrg = counts.get(row.organizationId) ?? {};
        const bucket: CountBucket = row.status === 'available' ? row.visibility : row.status;
        forOrg[bucket] = (forOrg[bucket] ?? 0) + row._count._all;
        counts.set(row.organizationId, forOrg);
      }
      return counts;
    },

    /**
     * Quarantined documents of the organization the viewer may see: by the visibility rule,
     * only their own uploads. Most recently changed first.
     */
    listQuarantined(
      viewer: DocumentViewer,
      organizationId: string,
      limit = 10,
    ): Promise<DocumentRecord[]> {
      return db.document.findMany({
        where: visible(viewer, { organizationId, status: 'quarantined' }),
        orderBy: { updatedAt: 'desc' },
        take: limit,
        select: documentSelect,
      });
    },

    /**
     * The organization's latest activity, newest first. Documents are loaded
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
  };
}

export type DashboardRepository = ReturnType<typeof createDashboardRepository>;
