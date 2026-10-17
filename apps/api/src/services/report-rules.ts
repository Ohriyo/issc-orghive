import { PROJECT_TASK_LABELS, type ProjectTaskType } from '@orghive/shared';

/** The order every project's files appear in (docs/PROJECT_WORKFLOW_SPEC.md, section 4). */
export const REPORT_TASK_ORDER: readonly ProjectTaskType[] = [
  'PROPOSAL',
  'NOM',
  'MOM',
  'ACR',
  'FINANCIAL_REPORT',
];

/** Table-of-contents rows per page; the template is laid out for exactly this many. */
export const TOC_ROWS_PER_PAGE = 24;

/** A submitted task file, as the report needs it. */
export interface ReportFile {
  storageKey: string;
  mimeType: string;
}

export interface ReportProject {
  id: string;
  name: string;
  /** `YYYY-MM-DD` (Manila). */
  targetDate: string;
  location: string;
  beneficiaries: string;
  nomRequired: boolean;
  momRequired: boolean;
  /** Clean, undeleted task files by type. */
  files: Partial<Record<ProjectTaskType, ReportFile>>;
}

/** One part of the report, in order. Generated parts come from the HTML template. */
export type ReportPart =
  | { kind: 'cover' }
  | { kind: 'toc' }
  | { kind: 'divider'; project: ReportProject }
  | { kind: 'file'; project: ReportProject; task: ProjectTaskType; file: ReportFile }
  | { kind: 'missing'; project: ReportProject; task: ProjectTaskType };

/** The tasks a project's section lists: NOM and MOM only when needed (or filed anyway). */
export function reportTasks(project: ReportProject): ProjectTaskType[] {
  return REPORT_TASK_ORDER.filter(
    (task) =>
      (task !== 'NOM' || project.nomRequired || !!project.files.NOM) &&
      (task !== 'MOM' || project.momRequired || !!project.files.MOM),
  );
}

/**
 * The fixed order of section 4: a cover, the table of contents, then for each project by
 * target date (then name) a divider and its files Proposal -> NOM -> MOM -> ACR -> Financial
 * Report, with a "Not submitted" placeholder for each missing one.
 */
export function planReport(projects: readonly ReportProject[]): {
  projects: ReportProject[];
  parts: ReportPart[];
} {
  const sorted = [...projects].sort(
    (a, b) =>
      a.targetDate.localeCompare(b.targetDate) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
  const parts: ReportPart[] = [{ kind: 'cover' }, { kind: 'toc' }];
  for (const project of sorted) {
    parts.push({ kind: 'divider', project });
    for (const task of reportTasks(project)) {
      const file = project.files[task];
      parts.push(file ? { kind: 'file', project, task, file } : { kind: 'missing', project, task });
    }
  }
  return { projects: sorted, parts };
}

/** One row of the table of contents. */
export interface TocRow {
  /** A project heading, or one of its documents. */
  level: 'project' | 'task';
  label: string;
  /** "Not submitted" rows are marked. */
  missing: boolean;
  /** 1-based page in the final PDF. */
  page: number;
}

export function tocPageCount(parts: readonly ReportPart[]): number {
  const rows = parts.filter((p) => p.kind !== 'cover' && p.kind !== 'toc').length;
  return Math.max(1, Math.ceil(rows / TOC_ROWS_PER_PAGE));
}

/**
 * Where each part starts and the table of contents, given how many pages each part takes
 * (`pagesOf`: a file's own page count; every generated part is one page, the table of
 * contents `tocPageCount`). Pure, so the numbering is tested without rendering anything.
 */
export function paginate(
  parts: readonly ReportPart[],
  pagesOf: (part: ReportPart, index: number) => number,
): { starts: number[]; totalPages: number; toc: TocRow[] } {
  const starts: number[] = [];
  let next = 1;
  parts.forEach((part, i) => {
    starts.push(next);
    next += pagesOf(part, i);
  });
  const toc: TocRow[] = [];
  parts.forEach((part, i) => {
    if (part.kind === 'divider') {
      toc.push({ level: 'project', label: part.project.name, missing: false, page: starts[i]! });
    } else if (part.kind === 'file' || part.kind === 'missing') {
      toc.push({
        level: 'task',
        label: PROJECT_TASK_LABELS[part.task],
        missing: part.kind === 'missing',
        page: starts[i]!,
      });
    }
  });
  return { starts, totalPages: next - 1, toc };
}
