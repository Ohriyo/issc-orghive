import { useQuery } from '@tanstack/react-query';
import {
  collegeListResponseSchema,
  organizationDetailSchema,
  type CollegeSummary,
  type OrganizationDetail,
} from '@orghive/shared';
import type { HexGridCell } from '@/components/hex-grid';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

const FIVE_MINUTES = 5 * 60_000;

/** The single ISSC. Its slug is fixed by the seed and the organizations table. */
const ISSC_SLUG = 'issc';

/**
 * Where colleges sit in the 4-column hero honeycomb, row by row: `college` slots are
 * filled in API order, `filler` slots are decorative hexagons. Adapted from design/home.png:
 * three rows so it clears the About heading, and the fourth column (which bleeds off the
 * right edge on wide screens) holds only fillers so no college link is ever cut off.
 */
const HONEYCOMB = [
  ['filler', 'college', 'filler', 'filler'],
  ['college', 'college', 'college', 'filler'],
  ['college', 'college', 'college', 'filler'],
].flat();

/**
 * Lays colleges into the honeycomb pattern. Unused college slots become fillers, and
 * colleges beyond the pattern's seven slots are appended so none is ever dropped.
 */
export function toHoneycomb(colleges: CollegeSummary[]): HexGridCell[] {
  if (colleges.length === 0) return [];
  const queue = colleges.map(toCell);
  const cells = HONEYCOMB.map((slot) => (slot === 'college' ? (queue.shift() ?? null) : null));
  return [...cells, ...queue];
}

function toCell(college: CollegeSummary): HexGridCell {
  return {
    id: college.slug,
    label: college.name,
    // Colleges have no logo of their own yet; the CSC's logo stands in for the college.
    logoSrc: college.csc?.logoUrl ?? undefined,
    logoSrcSet: college.csc?.logoSrcSet ?? undefined,
    shortName: college.code,
    href: `/colleges/${college.slug}`,
  };
}

export interface SectionState<T> {
  data: T;
  isLoading: boolean;
  isError: boolean;
  retry: () => void;
}

export interface HomeData {
  colleges: SectionState<HexGridCell[]>;
  issc: SectionState<OrganizationDetail | undefined>;
}

/** Presenter for the home page: colleges for the hero honeycomb, and the ISSC profile. */
export function useHomeData(): HomeData {
  // Two independent queries, fetched in parallel; each section handles its own state.
  const colleges = useQuery({
    queryKey: queryKeys.colleges.list,
    queryFn: () => api.get('/colleges', { schema: collegeListResponseSchema }),
    select: (body) => toHoneycomb(body.colleges),
    staleTime: FIVE_MINUTES,
  });

  const issc = useQuery({
    queryKey: queryKeys.organizations.detail(ISSC_SLUG),
    queryFn: () => api.get(`/organizations/${ISSC_SLUG}`, { schema: organizationDetailSchema }),
    staleTime: FIVE_MINUTES,
  });

  return {
    colleges: {
      data: colleges.data ?? [],
      isLoading: colleges.isPending,
      isError: colleges.isError,
      retry: () => void colleges.refetch(),
    },
    issc: {
      data: issc.data,
      isLoading: issc.isPending,
      isError: issc.isError,
      retry: () => void issc.refetch(),
    },
  };
}
