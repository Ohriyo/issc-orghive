import type {
  DashboardMembership,
  DashboardOrganization,
  DashboardResponse,
  DocumentStatusCounts,
} from '@orghive/shared';
import type { PublicUrl } from '#src/lib/public-url';
import type { Storage } from '#src/lib/storage';
import type { DashboardRepository } from '#src/repositories/dashboard.repository';
import type { DocumentRepository } from '#src/repositories/document.repository';
import type { MembershipRepository } from '#src/repositories/membership.repository';
import { toOrganizationSummary } from '#src/services/college.service';
import { presentSummary, toStoredSummary } from '#src/services/document.service';
import type { DocumentViewerService } from '#src/services/document-viewer.service';

/** How many documents and activity entries each organization shows. */
export const DASHBOARD_RECENT_DOCUMENTS = 5;
export const DASHBOARD_NEEDS_REVISION = 10;
export const DASHBOARD_ACTIVITY = 10;

export interface DashboardServiceDeps {
  memberships: Pick<MembershipRepository, 'findActiveDetailsForUser'>;
  dashboard: Pick<
    DashboardRepository,
    'countByStatus' | 'listRejected' | 'listActivity' | 'countAwaitingReview'
  >;
  documents: Pick<DocumentRepository, 'list'>;
  viewers: Pick<DocumentViewerService, 'forUser'>;
  storage: Pick<Storage, 'presignGet'>;
  publicUrl: PublicUrl;
  now?: () => Date;
}

const NO_DOCUMENTS: DocumentStatusCounts = {
  draft: 0,
  pending: 0,
  approved: 0,
  rejected: 0,
  archived: 0,
};

/** `YYYY-MM-DD` of a DATE column (stored as UTC midnight). */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The signed-in workspace. Only the user's own active memberships decide which
 * organizations appear, so an officer never sees another organization's numbers; every
 * document read still goes through the repository's visibility filter.
 */
export function createDashboardService({
  memberships,
  dashboard,
  documents,
  viewers,
  storage,
  publicUrl,
  now = () => new Date(),
}: DashboardServiceDeps) {
  return {
    async forUser(userId: string): Promise<DashboardResponse> {
      const [active, viewer] = await Promise.all([
        memberships.findActiveDetailsForUser(userId, now()),
        viewers.forUser(userId),
      ]);
      if (viewer.kind !== 'user') throw new Error('A signed-in viewer was expected');

      const orgs = [...new Map(active.map((m) => [m.organization.id, m.organization])).values()];
      const counts = await dashboard.countByStatus(
        viewer,
        orgs.map((o) => o.id),
      );

      const organizations: DashboardOrganization[] = await Promise.all(
        orgs.map(async (org) => {
          const [recent, rejected, activity] = await Promise.all([
            documents.list(viewer, { organizationId: org.id, limit: DASHBOARD_RECENT_DOCUMENTS }),
            dashboard.listRejected(viewer, org.id, DASHBOARD_NEEDS_REVISION),
            dashboard.listActivity(viewer, org.id, DASHBOARD_ACTIVITY),
          ]);
          return {
            organization: { id: org.id, ...toOrganizationSummary(org, publicUrl) },
            counts: { ...NO_DOCUMENTS, ...counts.get(org.id) },
            recentDocuments: await Promise.all(
              recent.items.map((doc) => presentSummary(storage, toStoredSummary(doc))),
            ),
            needsRevision: await Promise.all(
              rejected.map(async ({ approvals, ...doc }) => ({
                document: await presentSummary(storage, toStoredSummary(doc)),
                remark: approvals[0]?.comment ?? null,
                reviewerName: approvals[0]?.approver.name ?? null,
                decidedAt: approvals[0]?.decidedAt.toISOString() ?? null,
              })),
            ),
            activity: activity.map((entry) => ({
              id: entry.id,
              kind: entry.action,
              at: entry.createdAt.toISOString(),
              actorName: entry.actorName,
              document: entry.document,
              version: entry.version,
            })),
          };
        }),
      );

      const membershipRows: DashboardMembership[] = active.map((m) => ({
        organizationId: m.organization.id,
        role: m.role,
        isHead: m.isHead,
        title: m.title,
        termEnd: m.termEnd ? isoDay(m.termEnd) : null,
      }));

      const reviewable = viewer.reviewableOrgIds;
      return {
        memberships: membershipRows,
        organizations,
        reviews: reviewable.length
          ? {
              pending: await dashboard.countAwaitingReview(viewer, reviewable),
              organizations: reviewable.length,
            }
          : null,
        isAdmin: viewer.isAdmin,
      };
    },
  };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
