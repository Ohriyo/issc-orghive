import { useQuery } from '@tanstack/react-query';
import { collegeListResponseSchema, type CollegeListResponse } from '@orghive/shared';
import type { SpotlightItem } from '@/components/spotlight-carousel/spotlight-carousel';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useFocusParam, type FocusParam } from './use-focus-param';

const FIVE_MINUTES = 5 * 60_000;

/** One slide per college: its name and motto, with its CSC's logo. */
export function toCollegeItems(body: CollegeListResponse): SpotlightItem[] {
  return body.colleges.map((college) => ({
    id: college.slug,
    name: college.name,
    motto: college.motto ?? undefined,
    // Colleges have no logo of their own yet; the CSC's logo stands in for the college.
    logoSrc: college.csc?.logoUrl ?? undefined,
    logoSrcSet: college.csc?.logoSrcSet ?? undefined,
    shortName: college.code,
    href: `/colleges/${college.slug}`,
  }));
}

const EMPTY: SpotlightItem[] = [];

export interface CollegeCarousel extends FocusParam {
  items: SpotlightItem[];
  isLoading: boolean;
  isError: boolean;
  retry: () => void;
}

/** Presenter for /colleges, the Collegiate Student Councils carousel. */
export function useCollegeCarousel(): CollegeCarousel {
  // Same key as the home page's colleges, so arriving from home needs no new request.
  const query = useQuery({
    queryKey: queryKeys.colleges.list,
    queryFn: () => api.get('/colleges', { schema: collegeListResponseSchema }),
    select: toCollegeItems,
    staleTime: FIVE_MINUTES,
  });
  const items = query.data ?? EMPTY;
  const focus = useFocusParam(items);

  return {
    items,
    ...focus,
    isLoading: query.isPending,
    isError: query.isError,
    retry: () => void query.refetch(),
  };
}
