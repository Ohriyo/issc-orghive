import type { DocumentViewer } from '#src/repositories/document-visibility';
import type { AccountRepository } from '#src/repositories/account.repository';

export interface DocumentViewerServiceDeps {
  accounts: Pick<AccountRepository, 'findAccount'>;
}

/**
 * Turns a user into a DocumentViewer: the shared account's organization. An account that
 * may not act for one right now (locked, deactivated, or the super admin, who belongs to
 * none) sees what the public sees. No organization reviews another's documents
 * (docs/PROJECT_WORKFLOW_SPEC.md, section 0).
 */
export function createDocumentViewerService({ accounts }: DocumentViewerServiceDeps) {
  return {
    async forUser(userId: string): Promise<DocumentViewer> {
      const account = await accounts.findAccount(userId);
      if (!account) return { kind: 'public' };
      return {
        kind: 'account',
        userId,
        organizationId: account.organization.id,
        organizationType: account.organization.type,
      };
    },
  };
}

export type DocumentViewerService = ReturnType<typeof createDocumentViewerService>;
