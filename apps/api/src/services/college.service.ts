import type {
  CollegeDetail,
  CollegeListResponse,
  CollegeSummary,
  OrganizationSummary,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { type Cache, cacheKeys, PUBLIC_READ_TTL_SECONDS } from '#src/lib/cache';
import type { PublicUrl } from '#src/lib/public-url';
import type { CollegeRecord, CollegeRepository } from '#src/repositories/college.repository';
import type { OrganizationRepository } from '#src/repositories/organization.repository';

export interface CollegeServiceDeps {
  colleges: Pick<CollegeRepository, 'list' | 'findBySlug'>;
  organizations: Pick<OrganizationRepository, 'listChildren'>;
  cache: Cache;
  publicUrl: PublicUrl;
}

type OrgFields = Pick<OrganizationSummary, 'type' | 'slug' | 'acronym' | 'name'> & {
  logoKey: string | null;
};

export function toOrganizationSummary(org: OrgFields, publicUrl: PublicUrl): OrganizationSummary {
  return {
    type: org.type,
    slug: org.slug,
    acronym: org.acronym,
    name: org.name,
    logoUrl: publicUrl(org.logoKey),
  };
}

/** Public college reads, cached for 10 minutes under `college:list` and `college:{slug}`. */
export function createCollegeService({
  colleges,
  organizations,
  cache,
  publicUrl,
}: CollegeServiceDeps) {
  function summary(college: CollegeRecord): CollegeSummary {
    const csc = college.organizations[0];
    return {
      code: college.code,
      slug: college.slug,
      name: college.name,
      motto: college.motto,
      csc: csc ? toOrganizationSummary(csc, publicUrl) : null,
    };
  }

  return {
    async list(): Promise<CollegeListResponse> {
      const result = await cache.getOrSet(
        cacheKeys.collegeList(),
        PUBLIC_READ_TTL_SECONDS,
        async () => ({ colleges: (await colleges.list()).map(summary) }),
      );
      return result ?? { colleges: [] };
    },

    /** The college, its CSC (with description) and the CSC's SBOs. Throws 404 for an unknown slug. */
    async getBySlug(slug: string): Promise<CollegeDetail> {
      const result = await cache.getOrSet<CollegeDetail>(
        cacheKeys.college(slug),
        PUBLIC_READ_TTL_SECONDS,
        async () => {
          const college = await colleges.findBySlug(slug);
          if (!college) return null;
          const csc = college.organizations[0];
          const sbos = csc ? await organizations.listChildren(csc.id) : [];
          return {
            ...summary(college),
            description: college.description,
            csc: csc
              ? { ...toOrganizationSummary(csc, publicUrl), description: csc.description }
              : null,
            sbos: sbos
              .filter((org) => org.type === 'SBO')
              .map((org) => toOrganizationSummary(org, publicUrl)),
          };
        },
      );
      if (!result) throw AppError.notFound('College not found');
      return result;
    },
  };
}

export type CollegeService = ReturnType<typeof createCollegeService>;
