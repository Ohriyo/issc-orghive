import type { OrganizationDetail } from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { type Cache, cacheKeys, PUBLIC_READ_TTL_SECONDS } from '#src/lib/cache';
import type { PublicUrl } from '#src/lib/public-url';
import type { OrganizationRepository } from '#src/repositories/organization.repository';
import { toOrganizationSummary } from '#src/services/college.service';

export interface OrganizationServiceDeps {
  organizations: Pick<OrganizationRepository, 'findBySlug'>;
  cache: Cache;
  publicUrl: PublicUrl;
}

/** Public organization profile, cached for 10 minutes under `org:{slug}`. */
export function createOrganizationService({
  organizations,
  cache,
  publicUrl,
}: OrganizationServiceDeps) {
  return {
    /** Throws 404 for an unknown or soft-deleted slug. */
    async getBySlug(slug: string): Promise<OrganizationDetail> {
      const result = await cache.getOrSet<OrganizationDetail>(
        cacheKeys.organization(slug),
        PUBLIC_READ_TTL_SECONDS,
        async () => {
          const org = await organizations.findBySlug(slug);
          if (!org) return null;
          const parent = org.parent && !org.parent.deletedAt ? org.parent : null;
          return {
            ...toOrganizationSummary(org, publicUrl),
            description: org.description,
            parent: parent ? toOrganizationSummary(parent, publicUrl) : null,
            college: org.college
              ? { code: org.college.code, slug: org.college.slug, name: org.college.name }
              : null,
          };
        },
      );
      if (!result) throw AppError.notFound('Organization not found');
      return result;
    },
  };
}

export type OrganizationService = ReturnType<typeof createOrganizationService>;
