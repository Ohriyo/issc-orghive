import { useQuery } from '@tanstack/react-query';
import { collegeDetailSchema, collegeSeo, type CollegeDetail, type PageSeo } from '@orghive/shared';
import type { HexGridCell } from '@/components/hex-grid';
import { api, ApiError } from '@/lib/api';
import { emphasize, joinNames, type TextSegment } from '@/lib/emphasis';
import { queryKeys } from '@/lib/query-keys';

const FIVE_MINUTES = 5 * 60_000;

/**
 * Where SBOs sit in the 4-column honeycomb, row by row, traced from design/college-cea.png:
 * the grid bleeds off the top and right edges, so the top row and the fourth column hold only
 * decorative fillers and no logo is ever cut off. `spare` is used only past six SBOs.
 */
const HONEYCOMB = [
  ['filler', 'sbo', 'filler', 'filler'],
  ['sbo', 'sbo', 'sbo', 'filler'],
  ['sbo', 'spare', 'sbo', 'filler'],
].flat();

const BASE_SLOTS = HONEYCOMB.filter((slot) => slot === 'sbo').length;

/** Lays SBOs into the honeycomb. Extra SBOs fill the spare slot, then append below. */
export function toSboHoneycomb(sbos: CollegeDetail['sbos']): HexGridCell[] {
  const queue = sbos.map((sbo): HexGridCell => ({
    id: sbo.slug,
    label: sbo.name,
    logoSrc: sbo.logoUrl ?? undefined,
    shortName: sbo.acronym,
    href: `/orgs/${sbo.slug}`,
  }));
  const useSpare = queue.length > BASE_SLOTS;
  const cells = HONEYCOMB.map((slot) =>
    slot === 'sbo' || (slot === 'spare' && useSpare) ? (queue.shift() ?? null) : null,
  );
  return [...cells, ...queue];
}

export interface CscCard {
  acronym: string;
  name: string;
  logoSrc?: string;
  description: TextSegment[] | null;
  paperworksHref: string;
}

export interface CollegePageModel {
  seo: PageSeo;
  name: string;
  code: string;
  /** The description, or a factual sentence listing the SBOs, with names in bold. */
  intro: TextSegment[] | null;
  honeycomb: HexGridCell[];
  sboCount: number;
  csc: CscCard | null;
  sbosHref: string;
}

/** Shapes GET /colleges/:slug into the college page. */
export function toCollegePage(college: CollegeDetail): CollegePageModel {
  const acronyms = college.sbos.map((sbo) => sbo.acronym);
  const terms = [college.name, ...acronyms, ...(college.csc ? [college.csc.acronym] : [])];

  let intro: TextSegment[] | null = null;
  if (college.description) {
    intro = emphasize(college.description, terms);
  } else if (acronyms.length > 0) {
    const noun = acronyms.length === 1 ? 'organization' : 'organizations';
    intro = emphasize(
      `The ${college.name} is home to ${acronyms.length} student body ${noun}: ${joinNames(acronyms)}.`,
      terms,
    );
  }

  return {
    seo: collegeSeo(college),
    name: college.name,
    code: college.code,
    intro,
    honeycomb: college.sbos.length > 0 ? toSboHoneycomb(college.sbos) : [],
    sboCount: college.sbos.length,
    csc: college.csc
      ? {
          acronym: college.csc.acronym,
          name: college.csc.name,
          logoSrc: college.csc.logoUrl ?? undefined,
          description: college.csc.description
            ? emphasize(college.csc.description, [college.csc.acronym, college.name])
            : null,
          paperworksHref: `/orgs/${college.csc.slug}/paperworks`,
        }
      : null,
    sbosHref: `/colleges/${college.slug}/organizations`,
  };
}

export type CollegePageState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; page: CollegePageModel };

/** Presenter for /colleges/:slug. Shares its cache entry with the SBO carousel. */
export function useCollegePage(slug: string): CollegePageState {
  const query = useQuery({
    queryKey: queryKeys.colleges.detail(slug),
    queryFn: () => api.get(`/colleges/${slug}`, { schema: collegeDetailSchema }),
    select: toCollegePage,
    staleTime: FIVE_MINUTES,
  });

  if (query.data) return { status: 'ready', page: query.data };
  if (query.error instanceof ApiError && [400, 404].includes(query.error.status)) {
    return { status: 'not-found' };
  }
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  return { status: 'loading' };
}
