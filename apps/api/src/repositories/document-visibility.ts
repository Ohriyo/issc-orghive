import type { Prisma } from '#src/generated/prisma/client';

/**
 * Who is asking for documents. Built by the viewer service from the user's active
 * memberships; repositories only read it.
 */
export type DocumentViewer =
  | { kind: 'public' }
  | {
      kind: 'user';
      userId: string;
      /** Holds an active `admin` membership on the ISSC. */
      isAdmin: boolean;
      /** Organizations the user is an active member of (any role). */
      memberOrgIds: string[];
      /** Organizations whose documents this user approves (docs/DOMAIN_RULES.md). */
      reviewableOrgIds: string[];
    };

export const PUBLIC_VIEWER: DocumentViewer = { kind: 'public' };

/**
 * The visibility rule every document query goes through. PROVISIONAL until the school
 * answers "who can see pending and rejected documents?" (docs/DOMAIN_RULES.md):
 * - Deleted documents: nobody.
 * - Public: approved documents with `public` visibility.
 * - Other signed-in users: approved documents with `public` or `members` visibility.
 * - Active members of the owning organization: every status and visibility.
 * - Its approvers: pending documents they must review, and approved ones (any visibility).
 * - Admins: everything not deleted.
 */
export function visibleDocumentsWhere(viewer: DocumentViewer): Prisma.DocumentWhereInput {
  const notDeleted: Prisma.DocumentWhereInput = {
    deletedAt: null,
    organization: { deletedAt: null },
  };

  if (viewer.kind === 'public') {
    return { ...notDeleted, status: 'approved', visibility: 'public' };
  }
  if (viewer.isAdmin) return notDeleted;

  return {
    ...notDeleted,
    OR: [
      { status: 'approved', visibility: { in: ['public', 'members'] } },
      { organizationId: { in: viewer.memberOrgIds } },
      { status: { in: ['pending', 'approved'] }, organizationId: { in: viewer.reviewableOrgIds } },
    ],
  };
}
