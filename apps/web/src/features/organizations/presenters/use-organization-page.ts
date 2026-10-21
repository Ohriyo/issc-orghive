import { useQuery } from '@tanstack/react-query';
import {
  organizationDetailSchema,
  organizationSeo,
  type OrganizationDetail,
  type PageSeo,
  type PublicOfficer,
  type SocialKind,
} from '@orghive/shared';
import { useDemoOrganizations } from '@/features/demo/presenters/use-demo-organizations';
import { api, ApiError } from '@/lib/api';
import { emphasize, type TextSegment } from '@/lib/emphasis';
import { queryKeys } from '@/lib/query-keys';

const FIVE_MINUTES = 5 * 60_000;

export interface OrganizationPageModel {
  seo: PageSeo;
  acronym: string;
  name: string;
  logoSrc?: string;
  logoSrcSet?: string;
  description: TextSegment[] | null;
  paperworksHref: string;
  /** Where the organization sits in the hierarchy, e.g. "A student body organization of" + its college. */
  context: { lead: string; college: { name: string; href: string } } | null;
  /** The cover photo band under the hero; none until the organization adds one. */
  cover: { src: string; srcSet?: string } | null;
  /** Mission and vision; null when it has written neither. */
  about: { mission: string | null; vision: string | null } | null;
  /** Public entries only: the API never sends hidden ones. */
  officers: PublicOfficer[];
  /** Null when it lists no email and no links. */
  contact: { email: string | null; links: ContactLink[] } | null;
  /** Its projects on show are demo data (db:seed:demo): the page says "Sample data". */
  sample: boolean;
}

export interface ContactLink {
  url: string;
  kind: SocialKind;
  /** "Facebook", or the website's host. */
  label: string;
  /** The address without https:// and a trailing slash, e.g. "facebook.com/jpice.nwssu". */
  display: string;
}

/** A link as people read it: no scheme, no "www.", no trailing slash. */
export function displayUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
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
    logoSrcSet: org.logoSrcSet ?? undefined,
    description: org.description ? emphasize(org.description, [org.acronym, org.name]) : null,
    paperworksHref: `/orgs/${org.slug}/paperworks`,
    context:
      lead && org.college
        ? { lead, college: { name: org.college.name, href: `/colleges/${org.college.slug}` } }
        : null,
    cover: org.coverUrl ? { src: org.coverUrl, srcSet: org.coverSrcSet ?? undefined } : null,
    about: org.mission || org.vision ? { mission: org.mission, vision: org.vision } : null,
    officers: org.officers,
    contact:
      org.contactEmail || org.links.length > 0
        ? {
            email: org.contactEmail,
            links: org.links.map((link) => ({ ...link, display: displayUrl(link.url) })),
          }
        : null,
    sample: false,
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

  const demo = useDemoOrganizations();

  if (query.data) return { status: 'ready', page: { ...query.data, sample: demo.has(slug) } };
  if (query.error instanceof ApiError && [400, 404].includes(query.error.status)) {
    return { status: 'not-found' };
  }
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  return { status: 'loading' };
}
