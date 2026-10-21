import { useQuery } from '@tanstack/react-query';
import {
  handbookEditionListSchema,
  handbookResponseSchema,
  type HandbookEditionSummary,
} from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { yearLabel } from './use-handbook';

const FIVE_MINUTES = 5 * 60_000;

export interface EditionCard {
  academicYear: string;
  yearLabel: string;
  isCurrent: boolean;
  pageCount: number | null;
  coverUrl: string | null;
  /** The current edition reads at /handbook; past ones at /handbook/:year. */
  href: string;
}

export function toEditionCard(edition: HandbookEditionSummary): EditionCard {
  return {
    academicYear: edition.academicYear,
    yearLabel: yearLabel(edition.academicYear),
    isCurrent: edition.isCurrent,
    pageCount: edition.pageCount,
    coverUrl: edition.coverUrl,
    href: edition.isCurrent ? '/handbook' : `/handbook/${edition.academicYear}`,
  };
}

export type EditionsModel =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; editions: EditionCard[] };

/** /handbook/editions: every edition readers can open, newest first. */
export function useHandbookEditions(): EditionsModel {
  const query = useQuery({
    queryKey: queryKeys.handbook.editions,
    queryFn: () => api.get('/handbook/editions', { schema: handbookEditionListSchema }),
    staleTime: FIVE_MINUTES,
  });
  if (query.isPending) return { status: 'loading' };
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  return { status: 'ready', editions: query.data.editions.map(toEditionCard) };
}

export type HandbookCardModel =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'none' }
  | { status: 'ready'; edition: EditionCard };

/** The homepage card: the current edition, shared with /handbook's cache entry. */
export function useHandbookCard(): HandbookCardModel {
  const query = useQuery({
    queryKey: queryKeys.handbook.edition(null),
    queryFn: () => api.get('/handbook', { schema: handbookResponseSchema }),
    staleTime: FIVE_MINUTES,
  });
  if (query.isPending) return { status: 'loading' };
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  const edition = query.data.edition;
  return edition ? { status: 'ready', edition: toEditionCard(edition) } : { status: 'none' };
}
