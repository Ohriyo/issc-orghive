import { socialLinkOf, type OrganizationDetail, type SocialLink } from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { type Cache, cacheKeys, PUBLIC_READ_TTL_SECONDS } from '#src/lib/cache';
import { logoSrcSet, type PublicUrl } from '#src/lib/public-url';
import type { OrganizationRepository } from '#src/repositories/organization.repository';
import { toOrganizationSummary } from '#src/services/college.service';

export interface OrganizationServiceDeps {
  organizations: Pick<OrganizationRepository, 'findPublicProfile'>;
  cache: Cache;
  publicUrl: PublicUrl;
}

/** The Facebook page first, then the other links in the organization's order. */
export function profileLinksOf(facebookUrl: string | null, links: { url: string }[]): SocialLink[] {
  return [...(facebookUrl ? [facebookUrl] : []), ...links.map((link) => link.url)].map((url) => ({
    url,
    ...socialLinkOf(url),
  }));
}

/** Public organization profile, cached for 10 minutes under `org:{slug}:v2` (cacheKeys.organization). */
export function createOrganizationService({
  organizations,
  cache,
  publicUrl,
}: OrganizationServiceDeps) {
  return {
    /** Throws 404 for an unknown or soft-deleted slug. Hidden officers are never included. */
    async getBySlug(slug: string): Promise<OrganizationDetail> {
      const result = await cache.getOrSet<OrganizationDetail>(
        cacheKeys.organization(slug),
        PUBLIC_READ_TTL_SECONDS,
        async () => {
          const org = await organizations.findPublicProfile(slug);
          if (!org) return null;
          const parent = org.parent && !org.parent.deletedAt ? org.parent : null;
          return {
            id: org.id,
            ...toOrganizationSummary(org, publicUrl),
            description: org.description,
            parent: parent ? toOrganizationSummary(parent, publicUrl) : null,
            college: org.college
              ? { code: org.college.code, slug: org.college.slug, name: org.college.name }
              : null,
            mission: org.mission,
            vision: org.vision,
            contactEmail: org.contactEmail,
            links: profileLinksOf(org.facebookUrl, org.links),
            officers: org.officers,
            coverUrl: publicUrl(org.coverKey),
            coverSrcSet: logoSrcSet(publicUrl, org.coverKey, org.coverWidths),
          };
        },
      );
      if (!result) throw AppError.notFound('Organization not found');
      return result;
    },
  };
}

export type OrganizationService = ReturnType<typeof createOrganizationService>;
