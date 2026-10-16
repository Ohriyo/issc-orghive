/** TanStack Query keys, shared so features reuse each other's cached data. */
export const queryKeys = {
  colleges: {
    list: ['colleges', 'list'] as const,
    detail: (slug: string) => ['colleges', 'detail', slug] as const,
  },
  organizations: {
    detail: (slug: string) => ['organizations', 'detail', slug] as const,
  },
};
