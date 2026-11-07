import { useQuery } from '@tanstack/react-query';
import { organizationPageSchema, type OrganizationPage } from '@orghive/shared';
import { useAuth } from '@/features/auth/presenters/use-auth';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { toPostCard, type PostCardModel } from './post-format';

const TWO_MINUTES = 2 * 60_000;

export interface OrgPostSectionsModel {
  highlights: PostCardModel[];
  updates: PostCardModel[];
  /** More updates than the page shows: "View all updates" says how many. */
  updatesTotal: number;
  updatesHref: string;
  highlightsHref: string;
  /** The organization's own account: show the way into the editor. */
  isOwner: boolean;
}

export type OrgPostSectionsState =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; sections: OrgPostSectionsModel };

export function toPostSections(slug: string, page: OrganizationPage): OrgPostSectionsModel {
  return {
    highlights: page.highlights.map((p) => toPostCard(slug, p)),
    updates: page.updates.map((p) => toPostCard(slug, p)),
    updatesTotal: page.updatesTotal,
    updatesHref: `/orgs/${slug}/updates`,
    highlightsHref: `/orgs/${slug}/updates?type=highlight`,
    isOwner: page.viewer.isOwner,
  };
}

/**
 * Presenter for the post sections of /orgs/:slug (GET /organizations/:slug/page): the
 * pinned highlights, in pinned order, and the newest updates. Sections with nothing to show
 * are hidden by the view.
 */
export function useOrgPostSections(slug: string): OrgPostSectionsState {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: queryKeys.posts.page(slug, user?.id ?? 'anonymous'),
    queryFn: () => api.get(`/organizations/${slug}/page`, { schema: organizationPageSchema }),
    select: (page) => toPostSections(slug, page),
    staleTime: TWO_MINUTES,
  });
  if (query.data) return { status: 'ready', sections: query.data };
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  return { status: 'loading' };
}
