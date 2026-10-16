import type { DocumentViewer } from '#src/repositories/document-visibility';
import type { ActiveMembership, MembershipRepository } from '#src/repositories/membership.repository';
import type { OrganizationRepository } from '#src/repositories/organization.repository';

/** An active `admin` membership on the ISSC is system-wide; `admin` elsewhere grants nothing extra. */
export function isSystemAdmin(active: ActiveMembership[]): boolean {
  return active.some((m) => m.role === 'admin' && m.organization.type === 'ISSC');
}

export interface DocumentViewerServiceDeps {
  memberships: Pick<MembershipRepository, 'findActiveForUser'>;
  organizations: Pick<OrganizationRepository, 'listIds'>;
  now?: () => Date;
}

/**
 * Turns a user's active memberships into a DocumentViewer, including which
 * organizations' documents they approve. Approval chain (docs/DOMAIN_RULES.md):
 * - SBO documents: the head (Governor) of the parent CSC. Confirmed.
 * - CSC documents: "the ISSC". Which ISSC position is still open; PROVISIONAL: the ISSC head.
 * - ISSC documents: the ISSC adviser. Confirmed.
 */
export function createDocumentViewerService({
  memberships,
  organizations,
  now = () => new Date(),
}: DocumentViewerServiceDeps) {
  return {
    async forUser(userId: string): Promise<DocumentViewer> {
      const active = await memberships.findActiveForUser(userId, now());

      const isAdmin = isSystemAdmin(active);
      const memberOrgIds = [...new Set(active.map((m) => m.organization.id))];

      const headedCscIds = active
        .filter((m) => m.isHead && m.organization.type === 'CSC')
        .map((m) => m.organization.id);
      const headsIssc = active.some((m) => m.isHead && m.organization.type === 'ISSC');
      const issc = active.find((m) => m.role === 'adviser' && m.organization.type === 'ISSC');

      const reviewable = new Set<string>();
      if (headedCscIds.length > 0) {
        for (const id of await organizations.listIds({ type: 'SBO', parentIds: headedCscIds })) {
          reviewable.add(id);
        }
      }
      if (headsIssc) {
        for (const id of await organizations.listIds({ type: 'CSC' })) reviewable.add(id);
      }
      if (issc) reviewable.add(issc.organization.id);

      return { kind: 'user', userId, isAdmin, memberOrgIds, reviewableOrgIds: [...reviewable] };
    },
  };
}

export type DocumentViewerService = ReturnType<typeof createDocumentViewerService>;
