import type { MembershipRole } from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { DocumentRepository } from '#src/repositories/document.repository';
import type { MembershipRepository } from '#src/repositories/membership.repository';
import type { OrganizationRepository } from '#src/repositories/organization.repository';
import { isSystemAdmin, type DocumentViewerService } from '#src/services/document-viewer.service';

/** The organization a request acts on. */
export interface OrgRef {
  id: string;
  slug: string;
}

/** What the guard knows about the request, for the admin-override audit entry. */
export interface AccessContext {
  method: string;
  /** The route pattern, e.g. "/api/v1/documents/:documentId". Never the body. */
  route: string;
  ip?: string;
}

/** How access was granted: a qualifying membership, or an audited ISSC admin override. */
export type AccessGrant = 'membership' | 'admin_override';

export interface AccessServiceDeps {
  memberships: Pick<MembershipRepository, 'findActiveForUser'>;
  organizations: Pick<OrganizationRepository, 'findBySlug'>;
  documents: Pick<DocumentRepository, 'organizationOf'>;
  viewers: Pick<DocumentViewerService, 'forUser'>;
  audit: Pick<AuditLogRepository, 'record'>;
  now?: () => Date;
}

/**
 * Authorization for org-scoped routes. Always reads memberships from the database, never
 * from the access token, so a term that ended or a role that was removed stops granting
 * access immediately instead of when the token expires.
 */
export function createAccessService({
  memberships,
  organizations,
  documents,
  viewers,
  audit,
  now = () => new Date(),
}: AccessServiceDeps) {
  async function adminOverride(
    userId: string,
    org: OrgRef,
    required: string,
    ctx: AccessContext,
  ): Promise<AccessGrant> {
    await audit.record({
      action: 'admin_override',
      actorId: userId,
      entityType: 'organization',
      entityId: org.id,
      organizationId: org.id,
      metadata: { required, method: ctx.method, route: ctx.route },
      ip: ctx.ip,
    });
    return 'admin_override';
  }

  return {
    async resolveBySlug(slug: string): Promise<OrgRef | null> {
      const org = await organizations.findBySlug(slug);
      return org && { id: org.id, slug: org.slug };
    },

    /** The organization owning a document. Null for unknown or deleted documents. */
    resolveByDocument(documentId: string): Promise<OrgRef | null> {
      return documents.organizationOf(documentId);
    },

    /**
     * Allows a user holding one of `roles` in `org` through an active membership. An ISSC
     * admin without such a role is let through too, and that override is audited.
     */
    async requireRole(
      userId: string,
      org: OrgRef,
      roles: readonly MembershipRole[],
      ctx: AccessContext,
    ): Promise<AccessGrant> {
      const active = await memberships.findActiveForUser(userId, now());
      if (active.some((m) => m.organization.id === org.id && roles.includes(m.role))) {
        return 'membership';
      }
      if (isSystemAdmin(active)) return adminOverride(userId, org, `role:${roles.join('|')}`, ctx);
      throw AppError.forbidden();
    },

    /**
     * Allows the approver of `org`'s documents (docs/DOMAIN_RULES.md), or an ISSC admin
     * through an audited override.
     */
    async requireApprover(userId: string, org: OrgRef, ctx: AccessContext): Promise<AccessGrant> {
      const viewer = await viewers.forUser(userId);
      if (viewer.kind === 'user' && viewer.reviewableOrgIds.includes(org.id)) return 'membership';
      if (viewer.kind === 'user' && viewer.isAdmin) {
        return adminOverride(userId, org, 'approver', ctx);
      }
      throw AppError.forbidden();
    },
  };
}

export type AccessService = ReturnType<typeof createAccessService>;
