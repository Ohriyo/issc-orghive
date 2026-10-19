import { useQuery } from '@tanstack/react-query';
import { appealListResponseSchema, organizationComplianceSchema } from '@orghive/shared';
import { isOwnOrganization, useAuth } from '@/features/auth/presenters/use-auth';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import {
  toAppealItem,
  toComplianceSummary,
  type AppealItem,
  type ComplianceSummary,
} from './appeal-format';

export type ComplianceModel =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | ({ status: 'ready' } & ComplianceSummary);

/** Whether the signed-in account is the organization's own (only it appeals). */
export function useIsOfficerOf(slug: string | null): boolean {
  const { user } = useAuth();
  return isOwnOrganization(user, { slug });
}

/**
 * The organization's blocks and freezes with their appeal state, for the banners on the
 * dashboard and the project page. Null until there is an organization to ask about.
 */
export function useCompliance(slug: string | null): ComplianceModel | null {
  const canAppeal = useIsOfficerOf(slug);
  const query = useQuery({
    queryKey: queryKeys.appeals.compliance(slug ?? ''),
    queryFn: () =>
      api.get(`/organizations/${slug}/compliance`, { schema: organizationComplianceSchema }),
    enabled: !!slug,
    staleTime: 60_000,
  });
  if (!slug) return null;
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  if (!query.data) return { status: 'loading' };
  return { status: 'ready', ...toComplianceSummary(query.data, slug, canAppeal) };
}

export type ProjectAppealsModel =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; items: AppealItem[] };

/** A project's appeal history, newest first (the project page). */
export function useProjectAppeals(projectId: string): ProjectAppealsModel {
  const query = useQuery({
    queryKey: queryKeys.appeals.project(projectId),
    queryFn: () => api.get(`/projects/${projectId}/appeals`, { schema: appealListResponseSchema }),
    staleTime: 60_000,
  });
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  if (!query.data) return { status: 'loading' };
  return { status: 'ready', items: query.data.items.map(toAppealItem) };
}
