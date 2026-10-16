import { useQuery } from '@tanstack/react-query';
import { collegeDetailSchema, type CollegeDetail } from '@orghive/shared';
import type { SpotlightItem } from '@/components/spotlight-carousel/spotlight-carousel';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useFocusParam, type FocusParam } from './use-focus-param';

const FIVE_MINUTES = 5 * 60_000;

/** One slide per student body organization of the college. */
export function toSboItems(college: CollegeDetail): SpotlightItem[] {
  return college.sbos.map((sbo) => ({
    id: sbo.slug,
    name: sbo.name,
    logoSrc: sbo.logoUrl ?? undefined,
    shortName: sbo.acronym,
    href: `/orgs/${sbo.slug}`,
  }));
}

function select(college: CollegeDetail) {
  return { college: { slug: college.slug, name: college.name }, items: toSboItems(college) };
}

const EMPTY: SpotlightItem[] = [];

export interface SboCarousel extends FocusParam {
  college: { slug: string; name: string } | undefined;
  items: SpotlightItem[];
  isLoading: boolean;
  /** The slug matches no college (404), or is not a valid slug at all (400). */
  isNotFound: boolean;
  isError: boolean;
  retry: () => void;
}

/** Presenter for /colleges/:slug/organizations, the Student Body Organizations carousel. */
export function useSboCarousel(slug: string): SboCarousel {
  const query = useQuery({
    queryKey: queryKeys.colleges.detail(slug),
    queryFn: () => api.get(`/colleges/${slug}`, { schema: collegeDetailSchema }),
    select,
    staleTime: FIVE_MINUTES,
  });
  const items = query.data?.items ?? EMPTY;
  const focus = useFocusParam(items);

  const isNotFound =
    query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400);

  return {
    college: query.data?.college,
    items,
    ...focus,
    isLoading: query.isPending,
    isNotFound,
    isError: query.isError && !isNotFound,
    retry: () => void query.refetch(),
  };
}
