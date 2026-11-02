import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  semesterCalendar,
  semesterCalendarResponseSchema,
  USUAL_SEMESTERS,
  type SemesterCalendar,
} from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

/**
 * The semester calendar (spec 5B): the dates the ISSC set, over the usual ones. Until it has
 * loaded, or when it cannot be, the usual dates; the API decides with the real ones anyway.
 */
export function useSemesterCalendar(): SemesterCalendar {
  const query = useQuery({
    queryKey: queryKeys.semesters,
    queryFn: () =>
      api.get('/semesters', { schema: semesterCalendarResponseSchema, background: true }),
    staleTime: 5 * 60_000,
  });
  const dates = query.data?.semesters;
  return useMemo(() => (dates ? semesterCalendar(dates) : USUAL_SEMESTERS), [dates]);
}
