import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  hidePostRequestSchema,
  orgPostSeo,
  postDetailSchema,
  type PageSeo,
  type PostDetail,
  type PostImage,
} from '@orghive/shared';
import { useActingAs, type ActingAsModel } from '@/features/auth/presenters/use-acting-as';
import { useAuth } from '@/features/auth/presenters/use-auth';
import { formatManilaDate } from '@/features/projects/presenters/project-format';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { postHref } from './post-format';

const TWO_MINUTES = 2 * 60_000;

export interface OrgPostModel {
  seo: PageSeo;
  id: string;
  title: string;
  /** "Highlight" or "Update". */
  kind: string;
  /** "Posted Nov 5, 2026", plus " · edited Nov 6" when it changed after going live. */
  posted: string;
  dateTime: string;
  /** "Event: Nov 5, 2026" when the event day differs from the post day. */
  event: string | null;
  cover: PostImage | null;
  /** Rendered and sanitized by the server (lib/markdown.ts); the only HTML it may hold. */
  bodyHtml: string;
  gallery: PostImage[];
  externalLink: string | null;
  org: { acronym: string; name: string; href: string; logoUrl: string | null };
  previous: { href: string; title: string } | null;
  next: { href: string; title: string } | null;
  allHref: string;
  /** Own account: a note on a post nobody else sees yet, or on one a governing body hid. */
  ownerNotice: { tone: 'info' | 'warning'; text: string } | null;
  editHref: string | null;
  canModerate: boolean;
}

export function toOrgPost(post: PostDetail): OrgPostModel {
  const org = post.organization;
  const posted = formatManilaDate(post.publishedAt);
  const event = post.eventDate ? formatManilaDate(post.eventDate) : null;
  let ownerNotice: OrgPostModel['ownerNotice'] = null;
  if (post.viewer.isOwner) {
    if (post.moderation) {
      ownerNotice = {
        tone: 'warning',
        text: `Hidden on ${formatManilaDate(post.moderation.hiddenAt)} by a governing body: “${post.moderation.reason}” Only your account sees it. Edit it and publish it again to show it.`,
      };
    } else if (post.status === 'DRAFT') {
      ownerNotice = { tone: 'info', text: 'Draft: only your account sees this post.' };
    } else if (post.status === 'SCHEDULED') {
      ownerNotice = {
        tone: 'info',
        text: `Scheduled for ${formatManilaDate(post.publishedAt)}: only your account sees it until then.`,
      };
    }
  }
  return {
    seo: orgPostSeo(post),
    id: post.id,
    title: post.title,
    kind: post.type === 'HIGHLIGHT' ? 'Highlight' : 'Update',
    posted: `Posted ${posted}${post.editedAt ? ` · edited ${formatManilaDate(post.editedAt)}` : ''}`,
    dateTime: post.publishedAt,
    event: event && event !== posted ? `Event: ${event}` : null,
    cover: post.cover,
    bodyHtml: post.bodyHtml,
    gallery: post.gallery,
    externalLink: post.externalLink,
    org: {
      acronym: org.acronym,
      name: org.name,
      href: `/orgs/${org.slug}`,
      logoUrl: org.logoUrl,
    },
    previous: post.previous && {
      href: postHref(org.slug, post.previous.slug),
      title: post.previous.title,
    },
    next: post.next && { href: postHref(org.slug, post.next.slug), title: post.next.title },
    allHref: `/orgs/${org.slug}/updates`,
    ownerNotice,
    editHref: post.viewer.isOwner ? `/dashboard/posts/${post.id}` : null,
    canModerate: post.viewer.canModerate,
  };
}

export interface HideModel {
  /** The moderating council's acronym, for the "Acting as" hint. */
  moderatorAcronym: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  reason: string;
  setReason: (reason: string) => void;
  reasonError?: string;
  actingAs: ActingAsModel;
  submit: () => void;
  pending: boolean;
}

export type OrgPostState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; post: OrgPostModel; hide: HideModel };

/** Presenter for /orgs/:slug/updates/:postSlug, with a governing body's Hide action. */
export function useOrgPost(slug: string, postSlug: string): OrgPostState {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const actingAs = useActingAs();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string>();

  const query = useQuery({
    queryKey: queryKeys.posts.detail(slug, postSlug, user?.id ?? 'anonymous'),
    queryFn: () =>
      api.get(`/organizations/${slug}/posts/${postSlug}`, { schema: postDetailSchema }),
    select: toOrgPost,
    staleTime: TWO_MINUTES,
  });

  const hide = useMutation({
    mutationFn: (body: { actingAs: string; reason: string }) =>
      api.post(`/organizations/${slug}/posts/${query.data!.id}/hide`, body),
    onSuccess: async () => {
      toast.success('Post hidden. The organization was told why.');
      setOpen(false);
      setReason('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.posts.all });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'The post could not be hidden.');
    },
  });

  if (query.error instanceof ApiError && [400, 404].includes(query.error.status)) {
    return { status: 'not-found' };
  }
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  if (!query.data) return { status: 'loading' };

  return {
    status: 'ready',
    post: query.data,
    hide: {
      moderatorAcronym: user?.organization?.acronym ?? 'council',
      open,
      setOpen,
      reason,
      setReason: (value) => {
        setReason(value);
        setReasonError(undefined);
      },
      reasonError,
      actingAs,
      pending: hide.isPending,
      submit: () => {
        const name = actingAs.take();
        const parsed = hidePostRequestSchema.shape.reason.safeParse(reason);
        if (!parsed.success) setReasonError(parsed.error.issues[0]?.message);
        if (!name || !parsed.success) return;
        hide.mutate({ actingAs: name, reason: parsed.data });
      },
    },
  };
}
