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
      /** Organizations the user is an active officer of. */
      officerOrgIds: string[];
    };

export const PUBLIC_VIEWER: DocumentViewer = { kind: 'public' };

/**
 * The visibility rule every document query goes through, and the only place it is decided
 * (docs/DOMAIN_RULES.md). Nobody reviews documents; their visibility alone decides:
 * - Deleted documents: nobody.
 * - Before a document is available (scanning or quarantined): only its uploader.
 * - Available documents: `public` to anyone; `members` to active members of the owning
 *   organization; `private` to its officers.
 * - Archived documents: the owning organization's officers.
 * - Admins: every available or archived document, for support. Services audit each view
 *   an admin gets only through that (`visibleOnlyAsAdmin`).
 */
export function visibleDocumentsWhere(viewer: DocumentViewer): Prisma.DocumentWhereInput {
  const notDeleted: Prisma.DocumentWhereInput = {
    deletedAt: null,
    organization: { deletedAt: null },
  };

  if (viewer.kind === 'public') {
    return { ...notDeleted, status: 'available', visibility: 'public' };
  }

  const ownUnavailable: Prisma.DocumentWhereInput = {
    status: { in: ['scanning', 'quarantined'] },
    createdById: viewer.userId,
  };
  if (viewer.isAdmin) {
    return {
      ...notDeleted,
      OR: [{ status: { in: ['available', 'archived'] } }, ownUnavailable],
    };
  }

  return {
    ...notDeleted,
    OR: [
      { status: 'available', visibility: 'public' },
      {
        status: 'available',
        visibility: 'members',
        organizationId: { in: viewer.memberOrgIds },
      },
      { status: { in: ['available', 'archived'] }, organizationId: { in: viewer.officerOrgIds } },
      ownUnavailable,
    ],
  };
}

/**
 * Which versions of a visible document the viewer may list: clean files, plus the ones they
 * uploaded themselves while those are still being scanned or after they were refused.
 */
export function visibleVersionsWhere(viewer: DocumentViewer): Prisma.DocumentVersionWhereInput {
  if (viewer.kind === 'public') return { scanStatus: 'clean' };
  return { OR: [{ scanStatus: 'clean' }, { uploadedById: viewer.userId }] };
}

/** The same viewer without admin rights: what they would see as a plain member. */
export function withoutAdmin(viewer: DocumentViewer): DocumentViewer {
  return viewer.kind === 'user' ? { ...viewer, isAdmin: false } : viewer;
}
