import {
  compareMostOverdue,
  PROJECT_TASK_LABELS,
  SEMESTER_LABELS,
  toCsv,
  type ComplianceOverview,
  type ComplianceRow,
} from '@orghive/shared';
import {
  deadlineLabel,
  formatManilaDate,
  type DeadlineLabel,
} from '@/features/projects/presenters/project-format';

export type OverviewSort = 'overdue' | 'name';

export const SORT_OPTIONS: { value: OverviewSort; label: string }[] = [
  { value: 'overdue', label: 'Most overdue' },
  { value: 'name', label: 'Name' },
];

/** One organization of the overview, shaped for the table and the phone list. */
export interface ComplianceRowView {
  slug: string;
  acronym: string;
  name: string;
  /** "SBO · CEA", "CSC · CEA". */
  kind: string;
  href: string;
  activeProjects: number;
  nextDeadline: {
    task: string;
    projectName: string;
    href: string;
    label: DeadlineLabel;
  } | null;
  overdue: {
    count: number;
    /** "3 tasks, oldest 12 days"; null when nothing is overdue. */
    text: string | null;
    /** The oldest, for its project link. */
    oldest: { task: string; projectName: string; href: string } | null;
  };
  blocked: { id: string; name: string; href: string }[];
  /** "Frozen since Oct 3, 2026"; null when not frozen. */
  frozen: string | null;
  /** "Oct 3, 2026", for the table's short chip; null when not frozen. */
  frozenSince: string | null;
  openAppeals: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function toRowView(row: ComplianceRow, now: Date): ComplianceRowView {
  const { organization: org } = row;
  const oldest = row.overdueTasks[0];
  return {
    slug: org.slug,
    acronym: org.acronym,
    name: org.name,
    kind: org.college ? `${org.type} · ${org.college}` : org.type,
    href: `/orgs/${org.slug}`,
    activeProjects: row.activeProjects,
    nextDeadline: row.nextDeadline
      ? {
          task: PROJECT_TASK_LABELS[row.nextDeadline.task],
          projectName: row.nextDeadline.projectName,
          href: `/projects/${row.nextDeadline.projectId}`,
          label: deadlineLabel(row.nextDeadline.dueAt, now),
        }
      : null,
    overdue: {
      count: row.overdueTasks.length,
      text: oldest
        ? `${plural(row.overdueTasks.length, 'task')}, oldest ${plural(oldest.daysOverdue, 'day')}`
        : null,
      oldest: oldest
        ? {
            task: PROJECT_TASK_LABELS[oldest.task],
            projectName: oldest.projectName,
            href: `/projects/${oldest.projectId}`,
          }
        : null,
    },
    blocked: row.blockedProjects.map((p) => ({ ...p, href: `/projects/${p.id}` })),
    frozen: row.frozenSince ? `Frozen since ${formatManilaDate(row.frozenSince)}` : null,
    frozenSince: row.frozenSince ? formatManilaDate(row.frozenSince) : null,
    openAppeals: row.openAppeals,
  };
}

/** "Most overdue" is the shared rule (oldest overdue task first); "Name" is by acronym. */
export function sortRows(rows: ComplianceRow[], sort: OverviewSort): ComplianceRow[] {
  return [...rows].sort(
    sort === 'overdue'
      ? compareMostOverdue
      : (a, b) => a.organization.acronym.localeCompare(b.organization.acronym),
  );
}

export interface OverviewTotals {
  organizations: number;
  withOverdue: number;
  blockedProjects: number;
  frozen: number;
  openAppeals: number;
}

export function totalsOf(rows: ComplianceRow[]): OverviewTotals {
  return {
    organizations: rows.length,
    withOverdue: rows.filter((r) => r.overdueTasks.length > 0).length,
    blockedProjects: rows.reduce((sum, r) => sum + r.blockedProjects.length, 0),
    frozen: rows.filter((r) => r.frozenSince).length,
    openAppeals: rows.reduce((sum, r) => sum + r.openAppeals, 0),
  };
}

const CSV_HEADER = [
  'Organization',
  'Name',
  'Type',
  'College',
  'Active projects',
  'Next deadline',
  'Next deadline task',
  'Next deadline project',
  'Overdue tasks',
  'Oldest overdue (days)',
  'Blocked projects',
  'Blocked project names',
  'Frozen since',
  'Open appeals',
];

/**
 * The overview as CSV, in the order on screen. Dates are Manila calendar days
 * (`YYYY-MM-DD`) so spreadsheets sort them; toCsv guards against formula injection.
 */
export function overviewCsv(rows: ComplianceRow[]): string {
  const day = (iso: string) => formatManilaDay(iso);
  return toCsv([
    CSV_HEADER,
    ...rows.map((r) => [
      r.organization.acronym,
      r.organization.name,
      r.organization.type,
      r.organization.college ?? '',
      r.activeProjects,
      r.nextDeadline ? day(r.nextDeadline.dueAt) : '',
      r.nextDeadline ? PROJECT_TASK_LABELS[r.nextDeadline.task] : '',
      r.nextDeadline?.projectName ?? '',
      r.overdueTasks.length,
      r.overdueTasks[0]?.daysOverdue ?? 0,
      r.blockedProjects.length,
      r.blockedProjects.map((p) => p.name).join('; '),
      r.frozenSince ? day(r.frozenSince) : '',
      r.openAppeals,
    ]),
  ]);
}

const manilaDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' });

/** An instant as its Manila calendar day, `YYYY-MM-DD`. */
function formatManilaDay(iso: string): string {
  return manilaDay.format(new Date(iso));
}

/** "compliance-csc-cea-2026-2027-1st-semester.csv". */
export function csvFilename(
  overview: Pick<ComplianceOverview, 'scope' | 'academicYear' | 'semester'>,
) {
  const slug = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  return `compliance-${slug(overview.scope.acronym)}-${overview.academicYear}-${slug(SEMESTER_LABELS[overview.semester])}.csv`;
}
