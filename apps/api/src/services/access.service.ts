import { ErrorCode } from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import type { AccountRepository } from '#src/repositories/account.repository';
import type { AnnouncementRepository } from '#src/repositories/announcement.repository';
import type { DocumentRepository } from '#src/repositories/document.repository';
import type { OrganizationRepository } from '#src/repositories/organization.repository';
import type { ProjectRepository } from '#src/repositories/project.repository';
import { isGoverningBodyOf, isIssc } from '#src/services/account-rules';

/** The organization a request acts on. */
export interface OrgRef {
  id: string;
  slug: string;
}

/**
 * Who may act on an organization: `own` is its account alone (everything that changes its
 * work); `governing` also lets its governing bodies through, its college's CSC and the ISSC
 * (reading its projects, compliance and appeals).
 */
export type OrgAccessScope = 'own' | 'governing';

export interface AccessServiceDeps {
  accounts: Pick<AccountRepository, 'findAccount'>;
  organizations: Pick<OrganizationRepository, 'findBySlug'>;
  documents: Pick<DocumentRepository, 'organizationOf'>;
  projects: Pick<ProjectRepository, 'organizationOf'>;
  /** Only routes with :announcementId need it. */
  announcements?: Pick<AnnouncementRepository, 'organizationOf'>;
}

/**
 * Authorization for org-scoped routes, on shared organization accounts (docs/DOMAIN_RULES.md,
 * "Accounts"). Always read from the database, never from the access token, so a lock or a
 * deactivation stops granting access at once instead of when the token expires.
 */
export function createAccessService({
  accounts,
  organizations,
  documents,
  projects,
  announcements,
}: AccessServiceDeps) {
  return {
    /** The ISSC account only (the /admin screens). */
    async requireAdmin(userId: string): Promise<void> {
      const account = await accounts.findAccount(userId);
      if (!isIssc(account?.organization)) throw AppError.forbidden();
    },

    /**
     * A deactivated organization cannot upload or create projects (docs/DOMAIN_RULES.md,
     * "Administration").
     */
    async requireActive(org: OrgRef): Promise<void> {
      const found = await organizations.findBySlug(org.slug);
      if (found?.deactivatedAt) {
        throw new AppError(
          403,
          ErrorCode.ORGANIZATION_INACTIVE,
          'This organization is inactive. The ISSC can reactivate it.',
        );
      }
    },

    /** Lets the organization's own account through, or (`governing`) a governing body. */
    async requireOrgAccess(userId: string, org: OrgRef, scope: OrgAccessScope): Promise<void> {
      const account = await accounts.findAccount(userId);
      if (!account) throw AppError.forbidden();
      if (account.organization.id === org.id) return;
      if (scope === 'governing') {
        const target = await organizations.findBySlug(org.slug);
        if (target && isGoverningBodyOf(account.organization, target)) return;
      }
      throw AppError.forbidden();
    },

    async resolveBySlug(slug: string): Promise<OrgRef | null> {
      const org = await organizations.findBySlug(slug);
      return org && { id: org.id, slug: org.slug };
    },

    /** The organization owning a document. Null for unknown or deleted documents. */
    resolveByDocument(documentId: string): Promise<OrgRef | null> {
      return documents.organizationOf(documentId);
    },

    /** The council that posted an update. Null for unknown or deleted updates. */
    resolveByAnnouncement(announcementId: string): Promise<OrgRef | null> {
      if (!announcements) throw new Error('Wire announcements into the access service');
      return announcements.organizationOf(announcementId);
    },

    /** The organization owning a project. Null for unknown or deleted projects. */
    resolveByProject(projectId: string): Promise<OrgRef | null> {
      return projects.organizationOf(projectId);
    },
  };
}

export type AccessService = ReturnType<typeof createAccessService>;
