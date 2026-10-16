/** TanStack Query keys, shared so features reuse each other's cached data. */
export const queryKeys = {
  colleges: {
    list: ['colleges', 'list'] as const,
    detail: (slug: string) => ['colleges', 'detail', slug] as const,
  },
  organizations: {
    detail: (slug: string) => ['organizations', 'detail', slug] as const,
  },
  documents: {
    search: (q: string) => ['documents', 'search', q] as const,
    list: (slug: string, filters: Record<string, string | undefined>) =>
      ['documents', 'list', slug, filters] as const,
    detail: (id: string) => ['documents', 'detail', id] as const,
    types: ['documents', 'types'] as const,
  },
};
