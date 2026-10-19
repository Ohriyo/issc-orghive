import { useQuery } from '@tanstack/react-query';
import { collegeDetailSchema, organizationDetailSchema } from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { CollegePlace, OrgPlace } from './trails';

const FIVE_MINUTES = 5 * 60_000;

/**
 * An organization's place in the hierarchy, for its trail. Same query key and fetcher as
 * the organization presenters, so it reads their cache instead of a second request.
 */
export function useOrgPlace(slug: string | undefined): OrgPlace | null {
  const { data } = useQuery({
    queryKey: queryKeys.organizations.detail(slug ?? ''),
    queryFn: () => api.get(`/organizations/${slug}`, { schema: organizationDetailSchema }),
    enabled: !!slug,
    staleTime: FIVE_MINUTES,
  });
  if (!data) return null;
  return {
    slug: data.slug,
    acronym: data.acronym,
    type: data.type,
    college: data.college ? { code: data.college.code, slug: data.college.slug } : null,
  };
}

/** A college's code, for its trail. Shares the college presenters' cache. */
export function useCollegePlace(slug: string): CollegePlace | null {
  const { data } = useQuery({
    queryKey: queryKeys.colleges.detail(slug),
    queryFn: () => api.get(`/colleges/${slug}`, { schema: collegeDetailSchema }),
    staleTime: FIVE_MINUTES,
  });
  return data ? { code: data.code, slug: data.slug } : null;
}
