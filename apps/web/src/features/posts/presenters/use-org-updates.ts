import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { postListResponseSchema, type PostListResponse } from '@orghive/shared';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { toPostCard, type PostCardModel } from './post-format';

const ONE_MINUTE = 60_000;

export type UpdatesType = 'all' | 'update' | 'highlight';

export interface UpdatesFilterLink {
  label: string;
  /** Where this choice leads, e.g. "/orgs/asit/updates?type=highlight&year=2026". */
  href: string;
  current: boolean;
}

export interface OrgUpdatesModel {
  posts: PostCardModel[];
  total: number;
  types: UpdatesFilterLink[];
  years: UpdatesFilterLink[];
  /** "14 updates in 2026", "3 highlights". */
  summary: string;
  newer: string | null;
  older: string | null;
  page: number;
  pages: number;
}

export type OrgUpdatesState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; model: OrgUpdatesModel };

interface Filters {
  type: UpdatesType;
  year: string | undefined;
  page: number;
}

/** Reads ?type=update|highlight&year=2026&page=2; anything else falls back to the default. */
export function filtersOf(params: URLSearchParams): Filters {
  const type = params.get('type');
  const year = params.get('year');
  const page = Number(params.get('page'));
  return {
    type: type === 'update' || type === 'highlight' ? type : 'all',
    year: year && /^\d{4}$/.test(year) ? year : undefined,
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

function searchOf(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.type !== 'all') params.set('type', filters.type);
  if (filters.year) params.set('year', filters.year);
  if (filters.page > 1) params.set('page', String(filters.page));
  const text = params.toString();
  return text ? `?${text}` : '';
}

const NOUN: Record<UpdatesType, [string, string]> = {
  all: ['post', 'posts'],
  update: ['update', 'updates'],
  highlight: ['highlight', 'highlights'],
};

export function toOrgUpdates(slug: string, filters: Filters, data: PostListResponse): OrgUpdatesModel {
  const href = (f: Filters) => `/orgs/${slug}/updates${searchOf(f)}`;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const [one, many] = NOUN[filters.type];
  const types: [UpdatesType, string][] = [
    ['all', 'All'],
    ['update', 'Updates'],
    ['highlight', 'Highlights'],
  ];
  return {
    posts: data.items.map((p) => toPostCard(slug, p)),
    total: data.total,
    types: types.map(([type, label]) => ({
      label,
      href: href({ type, year: filters.year, page: 1 }),
      current: filters.type === type,
    })),
    years: [
      { label: 'All years', href: href({ ...filters, year: undefined, page: 1 }), current: !filters.year },
      ...data.years.map((y) => ({
        label: String(y),
        href: href({ ...filters, year: String(y), page: 1 }),
        current: filters.year === String(y),
      })),
    ],
    summary: `${data.total} ${data.total === 1 ? one : many}${filters.year ? ` in ${filters.year}` : ''}`,
    newer: filters.page > 1 ? href({ ...filters, page: filters.page - 1 }) : null,
    older: filters.page < pages ? href({ ...filters, page: filters.page + 1 }) : null,
    page: filters.page,
    pages,
  };
}

/** Presenter for /orgs/:slug/updates: live posts, newest first, by type and year. */
export function useOrgUpdates(slug: string): OrgUpdatesState & { type: UpdatesType } {
  const [params] = useSearchParams();
  const filters = filtersOf(params);
  const query = useQuery({
    queryKey: queryKeys.posts.list(slug, {
      type: filters.type,
      year: filters.year,
      page: String(filters.page),
    }),
    queryFn: () =>
      api.get(`/organizations/${slug}/posts${searchOf(filters)}`, {
        schema: postListResponseSchema,
      }),
    select: (data) => toOrgUpdates(slug, filters, data),
    placeholderData: keepPreviousData,
    staleTime: ONE_MINUTE,
  });
  if (query.data) return { status: 'ready', model: query.data, type: filters.type };
  if (query.error instanceof ApiError && [400, 404].includes(query.error.status)) {
    return { status: 'not-found', type: filters.type };
  }
  if (query.isError) return { status: 'error', retry: () => void query.refetch(), type: filters.type };
  return { status: 'loading', type: filters.type };
}
