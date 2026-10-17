import type { DocumentViewer } from '#src/repositories/document-visibility';
import type {
  ActiveMembership,
  MembershipRepository,
} from '#src/repositories/membership.repository';

/** An active `admin` membership on the ISSC is system-wide; `admin` elsewhere grants nothing extra. */
export function isSystemAdmin(active: ActiveMembership[]): boolean {
  return active.some((m) => m.role === 'admin' && m.organization.type === 'ISSC');
}

export interface DocumentViewerServiceDeps {
  memberships: Pick<MembershipRepository, 'findActiveForUser'>;
  now?: () => Date;
}

/**
 * Turns a user's active memberships into a DocumentViewer: which organizations they are a
 * member of, and which they are an officer of. A membership past its term grants nothing.
 * No organization reviews another's documents (docs/PROJECT_WORKFLOW_SPEC.md, section 0).
 */
export function createDocumentViewerService({
  memberships,
  now = () => new Date(),
}: DocumentViewerServiceDeps) {
  return {
    async forUser(userId: string): Promise<DocumentViewer> {
      const active = await memberships.findActiveForUser(userId, now());
      const idsWhere = (keep: (m: ActiveMembership) => boolean) => [
        ...new Set(active.filter(keep).map((m) => m.organization.id)),
      ];
      return {
        kind: 'user',
        userId,
        isAdmin: isSystemAdmin(active),
        memberOrgIds: idsWhere(() => true),
        officerOrgIds: idsWhere((m) => m.role === 'officer'),
      };
    },
  };
}

export type DocumentViewerService = ReturnType<typeof createDocumentViewerService>;
