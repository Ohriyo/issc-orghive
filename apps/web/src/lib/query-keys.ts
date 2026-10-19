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
    /**
     * The read-only compliance overview. Under 'projects', so project changes and appeal
     * decisions (which refresh every project query) refresh it too.
     */
    overview: (academicYear: string, semester: string) =>
      ['projects', 'compliance-overview', academicYear, semester] as const,
  },
  /**
   * Updates (announcements). Lists and details carry the viewer's canEdit/canPostFor, so the
   * viewer is part of the key: signing in or out never shows another viewer's answer.
   */
  announcements: {
    all: ['announcements'] as const,
    list: (org: string, viewer: string) => ['announcements', 'list', org, viewer] as const,
    detail: (id: string, viewer: string) => ['announcements', 'detail', id, viewer] as const,
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
  /** /system, the super admin console. */
  system: {
    all: ['system'] as const,
    overview: ['system', 'overview'] as const,
    users: (filters: Record<string, string | undefined>) => ['system', 'users', filters] as const,
    audit: (filters: Record<string, string | undefined>) => ['system', 'audit', filters] as const,
    security: ['system', 'security'] as const,
    account: (id: string) => ['system', 'account', id] as const,
    organizations: ['system', 'organizations'] as const,
    supportDocuments: (slug: string) => ['system', 'support', slug] as const,
    testData: ['system', 'test-data'] as const,
  },
  /** /admin screens. Never shared with the public reads they manage. */
  admin: {
    all: ['admin'] as const,
    organizations: ['admin', 'organizations'] as const,
  },
  /**
   * GET /me/notifications: the header bell. The notification center's pages sit under it, so
   * refreshing the bell refreshes them too.
   */
  notifications: ['me', 'notifications'] as const,
  notificationCenter: (show: 'all' | 'unread') => ['me', 'notifications', 'center', show] as const,
  notificationPreferences: ['me', 'notification-preferences'] as const,
};
