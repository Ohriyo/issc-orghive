/** TanStack Query keys, shared so features reuse each other's cached data. */
export const queryKeys = {
  /** GET /me/dashboard: every dashboard and My documents count hangs off it. */
  dashboard: ['me', 'dashboard'] as const,
  colleges: {
    list: ['colleges', 'list'] as const,
    detail: (slug: string) => ['colleges', 'detail', slug] as const,
  },
  organizations: {
    detail: (slug: string) => ['organizations', 'detail', slug] as const,
  },
  documents: {
    /** GET /search. Under 'documents', so every document mutation also refreshes searches. */
    search: (q: string) => ['documents', 'search', 'instant', q] as const,
    searchResults: (filters: Record<string, string | undefined>) =>
      ['documents', 'search', 'results', filters] as const,
    list: (slug: string, filters: Record<string, string | undefined>) =>
      ['documents', 'list', slug, filters] as const,
    detail: (id: string) => ['documents', 'detail', id] as const,
    types: ['documents', 'types'] as const,
    /** My documents: what the user may see of an organization, by state, visibility, search. */
    mine: (slug: string, filters: { status?: string; visibility?: string; q?: string }) =>
      ['documents', 'mine', slug, filters] as const,
  },
  /** Projects and their checklists (docs/PROJECT_WORKFLOW_SPEC.md, 2A and 2B). */
  projects: {
    all: ['projects'] as const,
    list: (slug: string) => ['projects', 'list', slug] as const,
    detail: (id: string) => ['projects', 'detail', id] as const,
  },
  /** Blocks, freezes and appeals (docs/PROJECT_WORKFLOW_SPEC.md, section 3). */
  appeals: {
    all: ['appeals'] as const,
    compliance: (slug: string) => ['appeals', 'compliance', slug] as const,
    project: (projectId: string) => ['appeals', 'project', projectId] as const,
    queue: (status: 'pending' | 'decided') => ['appeals', 'queue', status] as const,
    attachment: (id: string) => ['appeals', 'attachment', id] as const,
  },
  /** Semestral End Reports of an organization (docs/PROJECT_WORKFLOW_SPEC.md, section 4). */
  reports: {
    list: (slug: string) => ['reports', 'list', slug] as const,
  },
  /** GET /me/notifications: the header bell. */
  notifications: ['me', 'notifications'] as const,
};
