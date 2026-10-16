import { useQuery } from '@tanstack/react-query';
import {
  organizationDetailSchema,
  organizationSeo,
  type OrganizationDetail,
  type PageSeo,
} from '@orghive/shared';
import { api, ApiError } from '@/lib/api';
import { emphasize, type TextSegment } from '@/lib/emphasis';
import { queryKeys } from '@/lib/query-keys';

const FIVE_MINUTES = 5 * 60_000;

export interface OrganizationPageModel {
  seo: PageSeo;
  acronym: string;
  name: string;
  logoSrc?: string;
  description: TextSegment[] | null;
  paperworksHref: string;
  /** Where the organization sits in the hierarchy, e.g. "A student body organization of" + its college. */
  context: { lead: string; college: { name: string; href: string } } | null;
}

/** Shapes GET /organizations/:slug into the organization page. */
export function toOrganizationPage(org: OrganizationDetail): OrganizationPageModel {
  const lead =
    org.type === 'SBO'
      ? 'A student body organization of the'
      : org.type === 'CSC'
        ? 'The Collegiate Student Council of the'
        : null;

  return {
    seo: organizationSeo(org),
    acronym: org.acronym,
    name: org.name,
    logoSrc: org.logoUrl ?? undefined,
    description: org.description ? emphasize(org.description, [org.acronym, org.name]) : null,
    paperworksHref: `/orgs/${org.slug}/paperworks`,
    context:
      lead && org.college
        ? { lead, college: { name: org.college.name, href: `/colleges/${org.college.slug}` } }
        : null,
  };
}

export type OrganizationPageState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; page: OrganizationPageModel };

/** Presenter for /orgs/:slug. Shares its cache entry with the home page's ISSC profile. */
export function useOrganizationPage(slug: string): OrganizationPageState {
  const query = useQuery({
    queryKey: queryKeys.organizations.detail(slug),
    queryFn: () => api.get(`/organizations/${slug}`, { schema: organizationDetailSchema }),
    select: toOrganizationPage,
    staleTime: FIVE_MINUTES,
  });

  if (query.data) return { status: 'ready', page: query.data };
  if (query.error instanceof ApiError && [400, 404].includes(query.error.status)) {
    return { status: 'not-found' };
  }
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  return { status: 'loading' };
}
