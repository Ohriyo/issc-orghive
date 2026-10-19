import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import {
  dashboardResponseSchema,
  PROJECT_TASK_LABELS,
  projectListResponseSchema,
  type DashboardResponse,
  type ProjectStatus,
  type ProjectSummary,
} from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import {
  deadlineLabel,
  formatManilaDate,
  PROJECT_STATUS_LABEL,
  type DeadlineLabel,
} from './project-format';

const ONE_MINUTE = 60_000;

export interface ProjectCard {
  id: string;
  name: string;
  href: string;
  status: ProjectStatus;
  statusLabel: string;
  /** "Oct 20, 2026" */
  eventDate: string;
  location: string;
  /** The earliest open deadline, with its task. Null when nothing is due. */
  next: { taskLabel: string; deadline: DeadlineLabel } | null;
}

export type OrgOption = DashboardResponse['organizations'][number]['organization'];

export function toProjectCard(project: ProjectSummary, now: Date): ProjectCard {
  return {
    id: project.id,
    name: project.name,
    href: `/projects/${project.id}`,
    status: project.status,
    statusLabel: PROJECT_STATUS_LABEL[project.status],
    eventDate: formatManilaDate(project.targetDate),
    location: project.location,
    next: project.nextDeadline && {
      taskLabel: PROJECT_TASK_LABELS[project.nextDeadline.type],
      deadline: deadlineLabel(project.nextDeadline.dueAt, now),
    },
  };
}

/** Projects still in progress first (soonest deadline first), then the completed ones. */
export function sortForWork(projects: ProjectSummary[]): ProjectSummary[] {
  const rank = (p: ProjectSummary) => (p.status === 'completed' ? 1 : 0);
  return [...projects].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.nextDeadline?.dueAt ?? '9999').localeCompare(b.nextDeadline?.dueAt ?? '9999') ||
      a.targetDate.localeCompare(b.targetDate),
  );
}

/** The organization's own account creates projects and files tasks; nobody else. */
export function canManageProjects(data: DashboardResponse, orgId: string): boolean {
  return data.organizations.some((o) => o.organization.id === orgId);
}

export function projectsHref(slug: string): string {
  return `/dashboard/projects?org=${slug}`;
}

export function newProjectHref(slug: string): string {
  return `/dashboard/projects/new?org=${slug}`;
}

/** GET /organizations/:slug/projects. */
export function useProjectList(slug: string | undefined) {
  return useQuery({
    queryKey: queryKeys.projects.list(slug ?? ''),
    queryFn: () =>
      api.get(`/organizations/${slug}/projects`, { schema: projectListResponseSchema }),
    enabled: !!slug,
    staleTime: ONE_MINUTE,
  });
}

/** The dashboard's "Projects" section: up to three in progress, most urgent first. */
export interface ProjectsOverviewModel {
  status: 'loading' | 'error' | 'ready';
  retry: () => void;
  items: ProjectCard[];
  /** Projects in progress, beyond the ones shown. */
  more: number;
  allHref: string;
  newHref: string | null;
}

export const OVERVIEW_SIZE = 3;

export function useProjectsOverview(
  org: { slug: string } | null,
  canManage: boolean,
  now: () => Date = () => new Date(),
): ProjectsOverviewModel | null {
  const list = useProjectList(org?.slug);
  if (!org) return null;
  const open = sortForWork(list.data?.items ?? []).filter((p) => p.status !== 'completed');
  return {
    status: list.isPending ? 'loading' : list.isError ? 'error' : 'ready',
    retry: () => void list.refetch(),
    items: open.slice(0, OVERVIEW_SIZE).map((p) => toProjectCard(p, now())),
    more: Math.max(0, open.length - OVERVIEW_SIZE),
    allHref: projectsHref(org.slug),
    newHref: canManage ? newProjectHref(org.slug) : null,
  };
}

export type ProjectsPageModel =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'no-organization' }
  | {
      status: 'ready';
      organizations: OrgOption[];
      org: OrgOption;
      selectOrganization: (id: string) => void;
      newHref: string | null;
      list:
        | { status: 'loading' }
        | { status: 'error'; retry: () => void }
        | { status: 'ready'; inProgress: ProjectCard[]; completed: ProjectCard[] };
    };

/**
 * /dashboard/projects?org=: an organization's projects for its members. The organization
 * lives in the URL; the list of the user's organizations comes from the dashboard.
 */
export function useProjectsPage(now: () => Date = () => new Date()): ProjectsPageModel {
  const [params, setParams] = useSearchParams();
  const dashboard = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => api.get('/me/dashboard', { schema: dashboardResponseSchema }),
    staleTime: ONE_MINUTE,
  });
  const organizations = dashboard.data?.organizations.map((o) => o.organization) ?? [];
  const org = organizations.find((o) => o.slug === params.get('org')) ?? organizations[0];
  const list = useProjectList(org?.slug);

  if (dashboard.isPending) return { status: 'loading' };
  if (dashboard.isError) return { status: 'error', retry: () => void dashboard.refetch() };
  if (!org) return { status: 'no-organization' };

  const at = now();
  const sorted = sortForWork(list.data?.items ?? []);
  return {
    status: 'ready',
    organizations,
    org,
    selectOrganization: (id) => {
      const next = organizations.find((o) => o.id === id);
      if (next) setParams(new URLSearchParams({ org: next.slug }));
    },
    newHref: canManageProjects(dashboard.data, org.id) ? newProjectHref(org.slug) : null,
    list: list.isPending
      ? { status: 'loading' }
      : list.isError
        ? { status: 'error', retry: () => void list.refetch() }
        : {
            status: 'ready',
            inProgress: sorted
              .filter((p) => p.status !== 'completed')
              .map((p) => toProjectCard(p, at)),
            completed: sorted
              .filter((p) => p.status === 'completed')
              .map((p) => toProjectCard(p, at)),
          },
  };
}
