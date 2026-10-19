import type { OrganizationType } from '@orghive/shared';
import type { Prisma } from '#src/generated/prisma/client';

/**
 * Who is asking for documents. Built by the viewer service from the shared account; the
 * repositories only read it. The super admin, and any account that acts for no organization,
 * is a public viewer here: the console never browses an organization's files.
 */
export type DocumentViewer =
  | { kind: 'public' }
  | {
      kind: 'account';
      userId: string;
      organizationId: string;
      organizationType: OrganizationType;
    };

export const PUBLIC_VIEWER: DocumentViewer = { kind: 'public' };

/**
 * The visibility rule every document query goes through, and the only place it is decided
 * (docs/DOMAIN_RULES.md, "Visibility"). Nobody reviews documents; their visibility alone
 * decides:
 * - Deleted documents: nobody.
 * - The owning organization's account: every one of its documents, in any state.
 * - Others, available documents only: `public` to anyone; `governing` to the organization's
 *   governing bodies (its college's CSC, and the ISSC; account-rules.ts); `private` to
 *   nobody else at all, not the CSC, the ISSC or the super admin.
 * - Scanning, quarantined and archived documents: the owning organization only.
 */
export function visibleDocumentsWhere(viewer: DocumentViewer): Prisma.DocumentWhereInput {
  const notDeleted: Prisma.DocumentWhereInput = {
    deletedAt: null,
    organization: { deletedAt: null },
  };
  const publicAvailable: Prisma.DocumentWhereInput = { status: 'available', visibility: 'public' };

  if (viewer.kind === 'public') return { ...notDeleted, ...publicAvailable };

  const governed: Prisma.DocumentWhereInput | null =
    viewer.organizationType === 'ISSC'
      ? {}
      : viewer.organizationType === 'CSC'
        ? { organization: { type: 'SBO', parentId: viewer.organizationId } }
        : null;

  return {
    ...notDeleted,
    OR: [
      { organizationId: viewer.organizationId },
      publicAvailable,
      ...(governed
        ? [{ status: 'available' as const, visibility: 'governing' as const, ...governed }]
        : []),
    ],
  };
}

/**
 * Which versions of a visible document the viewer may list: clean files, plus every version
 * of its own organization's documents while they are scanned or after they were refused.
 */
export function visibleVersionsWhere(viewer: DocumentViewer): Prisma.DocumentVersionWhereInput {
  if (viewer.kind === 'public') return { scanStatus: 'clean' };
  return {
    OR: [{ scanStatus: 'clean' }, { document: { organizationId: viewer.organizationId } }],
  };
}
