import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { organizationDetailSchema, orgUpdatesSeo } from '@orghive/shared';
import { NotFoundPanel } from '@/components/not-found-panel';
import { api, apiUrl } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useOrgPlace } from '@/navigation/use-places';
import { useManagePosts } from './presenters/use-manage-posts';
import { useOrgPost } from './presenters/use-org-post';
import { usePostEditor } from './presenters/use-post-editor';
import { useOrgUpdates } from './presenters/use-org-updates';
import { ManagePostsView } from './views/manage-posts-view';
import { OrgPostView } from './views/org-post-view';
import { PostEditorView } from './views/post-editor-view';
import { OrgUpdatesView } from './views/org-updates-view';

const FIVE_MINUTES = 5 * 60_000;

/** The organization's name for titles; shares the organization page's cache entry. */
function useOrgName(slug: string) {
  return useQuery({
    queryKey: queryKeys.organizations.detail(slug),
    queryFn: () => api.get(`/organizations/${slug}`, { schema: organizationDetailSchema }),
    select: (org) => ({ slug: org.slug, acronym: org.acronym, name: org.name }),
    staleTime: FIVE_MINUTES,
  }).data;
}

/** /orgs/:slug/updates: the organization's updates and highlights. */
export function OrgUpdatesPage() {
  const { slug = '' } = useParams();
  const state = useOrgUpdates(slug);
  const org = useOrgName(slug);
  usePageChrome(chrome.orgUpdates(slug, useOrgPlace(slug)));

  if (state.status === 'not-found') {
    return (
      <NotFoundPanel
        title="Organization not found"
        message="There is no organization at this address. Find it through its college instead."
        action={{ label: 'See all colleges', to: '/colleges' }}
      />
    );
  }
  return (
    <OrgUpdatesView
      state={state}
      acronym={org?.acronym ?? 'Organization'}
      seo={org ? orgUpdatesSeo(org) : null}
      rssUrl={apiUrl(`/organizations/${slug}/posts/rss.xml`)}
    />
  );
}

/** /orgs/:slug/updates/:postSlug: one update or highlight. */
export function OrgPostPage() {
  const { slug = '', postSlug = '' } = useParams();
  const state = useOrgPost(slug, postSlug);
  usePageChrome(
    chrome.orgPost(slug, useOrgPlace(slug), state.status === 'ready' ? state.post.title : null),
  );

  if (state.status === 'not-found') {
    return (
      <NotFoundPanel
        title="Post not found"
        message="This update may have been removed, or its address changed. The organization’s other updates are still there."
        action={{ label: 'See all updates', to: `/orgs/${slug}/updates` }}
      />
    );
  }
  return <OrgPostView {...state} />;
}

/** /dashboard/posts: the organization's own highlights and updates, and the carousel pins. */
export function ManagePostsPage() {
  const state = useManagePosts();
  usePageChrome(chrome.workspace('Highlights and updates'));
  return <ManagePostsView state={state} />;
}

/** /dashboard/posts/new and /dashboard/posts/:postId. */
export function PostEditorPage() {
  const { postId } = useParams();
  const state = usePostEditor(postId ?? null);
  usePageChrome(chrome.postEditor(postId ? 'Edit post' : 'New post'));
  return <PostEditorView state={state} />;
}
