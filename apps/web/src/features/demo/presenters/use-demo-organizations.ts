import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { demoStatusSchema } from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

const NONE: ReadonlySet<string> = new Set();

/**
 * Slugs of the organizations whose public pages show demo data (db:seed:demo), so they can
 * carry the "Sample data" chip. Empty while loading, on error, or when SHOW_DEMO_BADGE is
 * off: the chip only ever adds a note, so a failed read just leaves it out.
 */
export function useDemoOrganizations(): ReadonlySet<string> {
  const query = useQuery({
    queryKey: queryKeys.demoStatus,
    // A public read: background, so it never counts as session activity.
    queryFn: () => api.get('/demo-status', { schema: demoStatusSchema, background: true }),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const organizations = query.data?.organizations;
  return useMemo(() => (organizations ? new Set(organizations) : NONE), [organizations]);
}
