import {
  daysBetween,
  manilaDate,
  PROJECT_STATUSES,
  type ProjectStatus,
  type TaskDeadline,
} from '@orghive/shared';
import type { ProjectRecord } from '#src/repositories/project.repository';
import { planProject, type ProjectPlan } from './project-rules';
import { factsOf } from './project-sync.service';

/**
 * Read-only figures from the project rules, for the compliance overview and the dashboard.
 * Every project is planned on read with `planProject`, so the figures are right even
 * between the hourly compliance checks. No rule is re-implemented here: this only counts
 * what the plan says.
 */
export interface PlannedProject {
  record: ProjectRecord;
  plan: ProjectPlan;
}

export function planAll(records: ProjectRecord[], now: Date): PlannedProject[] {
  return records.map((record) => ({ record, plan: planProject(factsOf(record), now) }));
}

function deadline(p: PlannedProject, task: ProjectPlan['tasks'][number]): TaskDeadline {
  return {
    projectId: p.record.id,
    projectName: p.record.name,
    task: task.type,
    dueAt: task.dueAt!.toISOString(),
  };
}

/** Tasks past their deadline and not submitted, oldest first, with whole Manila days late. */
export function overdueTasks(
  projects: PlannedProject[],
  now: Date,
): (TaskDeadline & { daysOverdue: number })[] {
  const today = manilaDate(now);
  return projects
    .flatMap((p) =>
      p.plan.tasks
        .filter((t) => t.dueAt && t.status !== 'submitted' && t.dueAt < now)
        .map((t) => ({
          ...deadline(p, t),
          daysOverdue: Math.max(1, daysBetween(manilaDate(t.dueAt!), today)),
        })),
    )
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

/** Deadlines still ahead of open tasks, soonest first. */
export function upcomingDeadlines(projects: PlannedProject[], now: Date): TaskDeadline[] {
  return projects
    .flatMap((p) =>
      p.plan.tasks
        .filter((t) => t.dueAt && t.status === 'open' && t.dueAt >= now)
        .map((t) => deadline(p, t)),
    )
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

export function countByStatus(projects: PlannedProject[]): Record<ProjectStatus, number> {
  const counts = Object.fromEntries(PROJECT_STATUSES.map((s) => [s, 0])) as Record<
    ProjectStatus,
    number
  >;
  for (const p of projects) counts[p.plan.status]++;
  return counts;
}
