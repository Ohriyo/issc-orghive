import { useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  announcementListResponseSchema,
  announcementSchema,
  collegeListResponseSchema,
  organizationDetailSchema,
  type AnnouncementListResponse,
  type CollegeListResponse,
  type CreateAnnouncementRequest,
  type OrganizationDetail,
} from '@orghive/shared';
import type { FilterOption } from '@/components/filter-bar';
import { useAuth } from '@/features/auth/presenters/use-auth';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { toUpdateItem, type UpdateItem } from './update-format';

const PAGE_SIZE = 10;
const FIVE_MINUTES = 5 * 60_000;
const ISSC_SLUG = 'issc';

/** A council the signed-in user may post for. */
export interface PostingCouncil {
  slug: string;
  /** "CSC-CEA". */
  acronym: string;
}

/** The "Post an update" sheet; null for anyone who cannot post. */
export interface UpdateComposer {
  councils: PostingCouncil[];
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Publishes at once. Returns an error message for the form, or null once posted. */
  publish: (council: string, values: CreateAnnouncementRequest) => Promise<string | null>;
}

export type UpdatesModel = {
  /** The council filter, kept in the URL (?org=). */
  filter: { value: string; options: FilterOption[]; set: (slug: string) => void };
  composer: UpdateComposer | null;
} & (
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | {
      status: 'ready';
      items: UpdateItem[];
      /** Set while older updates remain. */
      more: { load: () => void; loading: boolean } | null;
    }
);

export function messageOf(error: unknown): string {
  if (error instanceof ApiError && (error.status === 0 || error.status < 500)) return error.message;
  return 'Something went wrong on our side. Try again in a moment.';
}

/** The councils that post updates, for the filter: the ISSC, then each college's CSC. */
export function councilOptions(
  issc: Pick<OrganizationDetail, 'slug' | 'acronym'> | undefined,
  colleges: CollegeListResponse | undefined,
): FilterOption[] {
  return [
    ...(issc ? [{ value: issc.slug, label: issc.acronym }] : []),
    ...(colleges?.colleges ?? []).flatMap((college) =>
      college.csc ? [{ value: college.csc.slug, label: college.csc.acronym }] : [],
    ),
  ];
}

/**
 * /updates: every update from the ISSC and the CSCs, newest first, readable signed out.
 * Officers of a council also get the "Post an update" sheet (the server's canPostFor).
 */
export function useUpdates(): UpdatesModel {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const viewer = user?.id ?? 'anonymous';
  const [params, setParams] = useSearchParams();
  const org = params.get('org') ?? '';
  const [open, setOpen] = useState(false);

  const colleges = useQuery({
    queryKey: queryKeys.colleges.list,
    queryFn: () => api.get('/colleges', { schema: collegeListResponseSchema }),
    staleTime: FIVE_MINUTES,
  });
  const issc = useQuery({
    queryKey: queryKeys.organizations.detail(ISSC_SLUG),
    queryFn: () => api.get(`/organizations/${ISSC_SLUG}`, { schema: organizationDetailSchema }),
    staleTime: FIVE_MINUTES,
  });
  const list = useInfiniteQuery({
    queryKey: queryKeys.announcements.list(org, viewer),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (org) search.set('org', org);
      if (pageParam) search.set('cursor', pageParam);
      return api.get(`/announcements?${search.toString()}`, {
        schema: announcementListResponseSchema,
      });
    },
    getNextPageParam: (last: AnnouncementListResponse) => last.nextCursor ?? undefined,
    staleTime: 60_000,
  });

  const options = councilOptions(issc.data, colleges.data);
  const filter = {
    // An unknown slug from a stale link still filters; it just has no label to show.
    value: org,
    options:
      org && !options.some((o) => o.value === org)
        ? [...options, { value: org, label: org }]
        : options,
    set: (slug: string) => setParams(slug ? { org: slug } : {}, { replace: true }),
  };

  const canPostFor = list.data?.pages[0]?.canPostFor ?? [];
  const composer: UpdateComposer | null =
    canPostFor.length > 0
      ? {
          councils: canPostFor.map((c) => ({ slug: c.slug, acronym: c.acronym })),
          open,
          setOpen,
          publish: async (council, values) => {
            try {
              const posted = await api.post(`/organizations/${council}/announcements`, values, {
                schema: announcementSchema,
              });
              await queryClient.invalidateQueries({ queryKey: queryKeys.announcements.all });
              toast.success(`Posted for ${posted.organization.acronym}. Everyone can read it now.`);
              setOpen(false);
              return null;
            } catch (error) {
              return messageOf(error);
            }
          },
        }
      : null;

  const base = { filter, composer };
  if (list.isError) return { ...base, status: 'error', retry: () => void list.refetch() };
  if (!list.data) return { ...base, status: 'loading' };
  return {
    ...base,
    status: 'ready',
    items: list.data.pages.flatMap((page) => page.items.map(toUpdateItem)),
    more: list.hasNextPage
      ? { load: () => void list.fetchNextPage(), loading: list.isFetchingNextPage }
      : null,
  };
}
