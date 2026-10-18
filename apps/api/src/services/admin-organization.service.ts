import {
  ErrorCode,
  type AdminCollege,
  type AdminOrganization,
  type AdminOrganizationTree,
  type CreateCollegeRequest,
  type CreateOrganizationRequest,
  type UpdateCollegeRequest,
  type UpdateOrganizationRequest,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { type Cache, cacheKeys } from '#src/lib/cache';
import { LOGO_CACHE_CONTROL, LogoRejectedError, processLogo } from '#src/lib/logo';
import type { PublicUrl } from '#src/lib/public-url';
import type { Storage } from '#src/lib/storage';
import type {
  AdminCollegeRecord,
  AdminOrganizationRepository,
  AdminOrgRecord,
} from '#src/repositories/admin-organization.repository';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { Actor } from '#src/services/document.service';

export interface AdminOrganizationServiceDeps {
  admin: AdminOrganizationRepository;
  audit: Pick<AuditLogRepository, 'record'>;
  cache: Pick<Cache, 'deleteMatching'>;
  storage: Pick<Storage, 'put'>;
  publicUrl: PublicUrl;
  now?: () => Date;
}

const invalid = (message: string) => new AppError(400, ErrorCode.VALIDATION_ERROR, message);

/** True when `slugs` lists exactly the items in `current`, each once. */
function isPermutation(slugs: string[], current: string[]): boolean {
  return slugs.length === current.length && current.every((slug) => slugs.includes(slug));
}

/**
 * Colleges and organizations for ISSC admins (docs/DOMAIN_RULES.md, "Administration").
 * The route guard has checked the admin already. Every change is audited and clears the
 * public read caches, so carousels and college pages update at once.
 */
export function createAdminOrganizationService({
  admin,
  audit,
  cache,
  storage,
  publicUrl,
  now = () => new Date(),
}: AdminOrganizationServiceDeps) {
  function toOrg(org: AdminOrgRecord): AdminOrganization {
    return {
      type: org.type,
      slug: org.slug,
      acronym: org.acronym,
      name: org.name,
      description: org.description,
      logoUrl: publicUrl(org.logoKey),
      active: org.deactivatedAt === null,
      documentCount: org._count.documents,
      memberCount: org._count.memberships,
    };
  }

  function toCollege(college: AdminCollegeRecord, orgs: AdminOrgRecord[]): AdminCollege {
    const mine = orgs.filter((org) => org.collegeId === college.id);
    const csc = mine.find((org) => org.type === 'CSC');
    return {
      code: college.code,
      slug: college.slug,
      name: college.name,
      motto: college.motto,
      description: college.description,
      csc: csc ? toOrg(csc) : null,
      sbos: mine.filter((org) => org.type === 'SBO').map(toOrg),
    };
  }

  /** Public reads of colleges and this organization (college pages list their SBOs). */
  async function invalidate(orgSlug?: string) {
    await Promise.all([
      cache.deleteMatching('college:*'),
      orgSlug ? cache.deleteMatching(cacheKeys.organization(orgSlug)) : Promise.resolve(),
    ]);
  }

  function auditChange(
    actor: Actor,
    entity: 'college' | 'organization',
    id: string,
    change: string,
    details: Record<string, unknown> = {},
  ) {
    return audit.record({
      action: entity === 'college' ? 'college_change' : 'organization_change',
      actorId: actor.userId,
      entityType: entity,
      entityId: id,
      organizationId: entity === 'organization' ? id : null,
      metadata: { change, ...details },
      ip: actor.ip,
    });
  }

  async function loadCollege(slug: string): Promise<AdminCollegeRecord> {
    const college = await admin.findCollege(slug);
    if (!college) throw AppError.notFound('College not found');
    return college;
  }

  async function loadOrg(slug: string): Promise<AdminOrgRecord> {
    const org = await admin.findOrganization(slug, now());
    if (!org) throw AppError.notFound('Organization not found');
    return org;
  }

  async function collegeView(id: string): Promise<AdminCollege> {
    const { colleges, organizations } = await admin.tree(now());
    return toCollege(
      colleges.find((c) => c.id === id)!,
      organizations,
    );
  }

  async function treeView(): Promise<AdminOrganizationTree> {
    const { issc, colleges, organizations } = await admin.tree(now());
    return {
      issc: issc ? toOrg(issc) : null,
      colleges: colleges.map((college) => toCollege(college, organizations)),
    };
  }

  return {
    /** The ISSC, then every college with its CSC and SBOs, in carousel order. */
    tree: treeView,

    /** 409 when the code or slug is taken. New colleges go last in the carousel. */
    async createCollege(actor: Actor, input: CreateCollegeRequest): Promise<AdminCollege> {
      if (await admin.collegeTaken(input.code, input.slug)) {
        throw AppError.conflict('A college with this code or slug already exists');
      }
      const college = await admin.createCollege(input);
      await auditChange(actor, 'college', college.id, 'create', { slug: college.slug });
      await invalidate();
      return collegeView(college.id);
    },

    async updateCollege(
      actor: Actor,
      slug: string,
      patch: UpdateCollegeRequest,
    ): Promise<AdminCollege> {
      const college = await loadCollege(slug);
      if (patch.code && (await admin.collegeTaken(patch.code, college.slug, college.id))) {
        throw AppError.conflict('Another college already uses this code');
      }
      await admin.updateCollege(college.id, patch);
      await auditChange(actor, 'college', college.id, 'update', { fields: Object.keys(patch) });
      await invalidate();
      return collegeView(college.id);
    },

    /** `slugs` must list every college once, in the new carousel order. */
    async reorderColleges(actor: Actor, slugs: string[]): Promise<AdminOrganizationTree> {
      if (!isPermutation(slugs, await admin.collegeSlugs())) {
        throw invalid('slugs: List every college exactly once');
      }
      await admin.reorderColleges(slugs);
      await audit.record({
        action: 'college_change',
        actorId: actor.userId,
        entityType: 'college',
        entityId: null,
        organizationId: null,
        metadata: { change: 'reorder', order: slugs },
        ip: actor.ip,
      });
      await invalidate();
      return treeView();
    },

    /**
     * A CSC (one per college, under the ISSC) or an SBO (under its college's CSC). New
     * organizations go last in their carousel. 409 for a taken slug or a second CSC.
     */
    async createOrganization(
      actor: Actor,
      input: CreateOrganizationRequest,
    ): Promise<AdminOrganization> {
      const college = await loadCollege(input.collegeSlug);
      if (await admin.organizationSlugTaken(input.slug)) {
        throw AppError.conflict('An organization with this slug already exists');
      }
      const csc = await admin.cscOf(college.id);
      let parentId: string;
      if (input.type === 'CSC') {
        if (csc) throw AppError.conflict(`${college.code} already has a CSC`);
        const issc = await admin.issc();
        if (!issc) throw AppError.conflict('Create the ISSC first');
        parentId = issc.id;
      } else {
        if (!csc) throw AppError.conflict(`Create the CSC of ${college.code} first`);
        parentId = csc.id;
      }
      const org = await admin.createOrganization(
        {
          type: input.type,
          slug: input.slug,
          acronym: input.acronym,
          name: input.name,
          description: input.description,
          collegeId: college.id,
          parentId,
        },
        now(),
      );
      await auditChange(actor, 'organization', org.id, 'create', { type: org.type });
      await invalidate(org.slug);
      return toOrg(org);
    },

    async updateOrganization(
      actor: Actor,
      slug: string,
      patch: UpdateOrganizationRequest,
    ): Promise<AdminOrganization> {
      const org = await loadOrg(slug);
      const updated = await admin.updateOrganization(org.id, patch, now());
      await auditChange(actor, 'organization', org.id, 'update', { fields: Object.keys(patch) });
      await invalidate(org.slug);
      return toOrg(updated);
    },

    /**
     * Deactivated: hidden from browsing, no uploads or new projects; documents keep their
     * visibility. The ISSC cannot be deactivated. Repeating the current state is a no-op.
     */
    async setActive(actor: Actor, slug: string, active: boolean): Promise<AdminOrganization> {
      const org = await loadOrg(slug);
      if (org.type === 'ISSC' && !active) throw AppError.conflict('The ISSC cannot be deactivated');
      if ((org.deactivatedAt === null) === active) return toOrg(org);
      const updated = await admin.updateOrganization(
        org.id,
        { deactivatedAt: active ? null : now() },
        now(),
      );
      await auditChange(actor, 'organization', org.id, active ? 'activate' : 'deactivate');
      await invalidate(org.slug);
      return toOrg(updated);
    },

    /**
     * Replaces the logo: checked by its bytes, stored as WebP with srcset variants under a
     * new content-hashed key (the old files stay, so cached pages never break).
     */
    async setLogo(actor: Actor, slug: string, body: Buffer): Promise<AdminOrganization> {
      const org = await loadOrg(slug);
      let logo;
      try {
        logo = await processLogo(org.slug, body);
      } catch (err) {
        if (err instanceof LogoRejectedError) throw invalid(`logo: ${err.message}`);
        throw invalid('logo: This image could not be read');
      }
      for (const file of logo.files) {
        await storage.put(file.key, file.body, 'image/webp', LOGO_CACHE_CONTROL);
      }
      const updated = await admin.updateOrganization(
        org.id,
        { logoKey: logo.key, logoWidths: logo.widths },
        now(),
      );
      await auditChange(actor, 'organization', org.id, 'logo', { key: logo.key });
      await invalidate(org.slug);
      return toOrg(updated);
    },

    /** `slugs` must list every SBO of the college once, in the new carousel order. */
    async reorderSbos(actor: Actor, collegeSlug: string, slugs: string[]): Promise<AdminCollege> {
      const college = await loadCollege(collegeSlug);
      const csc = await admin.cscOf(college.id);
      if (!csc || !isPermutation(slugs, await admin.sboSlugs(csc.id))) {
        throw invalid(`slugs: List every SBO of ${college.code} exactly once`);
      }
      await admin.reorderOrganizations(slugs);
      await auditChange(actor, 'organization', csc.id, 'reorder', { order: slugs });
      await invalidate();
      return collegeView(college.id);
    },
  };
}

export type AdminOrganizationService = ReturnType<typeof createAdminOrganizationService>;
