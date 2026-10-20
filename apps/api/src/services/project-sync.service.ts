import type { ProjectTaskType } from '@orghive/shared';
import type { ProjectRecord, ProjectRepository } from '#src/repositories/project.repository';
import type { Compliance } from './compliance.service';
import type { LeaderboardRecompute } from './leaderboard-recompute';
import { planProject, type ProjectFacts } from './project-rules';

/** A task's file counts once it passed the virus scan (available) and was not deleted. */
const FILED_STATUSES = new Set(['available', 'archived']);

/** The rules' input, read from a stored project. */
export function factsOf(record: ProjectRecord): ProjectFacts {
  const filed = new Set<ProjectTaskType>();
  for (const task of record.tasks) {
    const doc = task.document;
    if (doc && !doc.deletedAt && FILED_STATUSES.has(doc.status)) filed.add(task.type);
  }
  return {
    createdAt: record.createdAt,
    targetDate: record.targetDate.toISOString().slice(0, 10),
    nomRequired: record.nomRequired,
    momRequired: record.momRequired,
    proposalDueOverride: record.proposalDueOverride,
    postEventDueOverride: record.postEventDueOverride,
    filed,
    exemptFromCompliance: record.organization.type === 'ISSC',
  };
}

export interface ProjectSyncDeps {
  projects: Pick<ProjectRepository, 'findById' | 'applyPlan' | 'projectOfDocument' | 'listOpenIds'>;
  /** What crossing a deadline sets off (section 3). Omitted where only the plan matters. */
  compliance?: Pick<Compliance, 'statusChanged' | 'planApplied'>;
  /** A task's file passing the scan may move the standings (spec 5B). */
  leaderboard?: Pick<LeaderboardRecompute, 'forEventDates'>;
  now?: () => Date;
}

/**
 * Keeps each project's stored checklist and status in step with the rules, and acts on what
 * the compliance rules find (blocks, freezes, reminders). Idempotent: run after every
 * change, on reads (the check on read), when the worker finds a task's file clean, and
 * hourly by the worker, so deadlines take effect even when nobody opens the project.
 */
export function createProjectSync({
  projects,
  compliance,
  leaderboard,
  now = () => new Date(),
}: ProjectSyncDeps) {
  async function sync(projectId: string): Promise<ProjectRecord | null> {
    const record = await projects.findById(projectId);
    if (!record) return null;
    const at = now();
    const plan = planProject(factsOf(record), at);
    const replaced = await projects.applyPlan(projectId, plan, at);
    if (compliance) {
      if (replaced) await compliance.statusChanged(record, replaced, plan);
      await compliance.planApplied(record, plan, at);
    }
    return projects.findById(projectId);
  }

  async function syncEach(ids: string[]): Promise<number> {
    for (const id of ids) await sync(id);
    return ids.length;
  }

  return {
    sync,

    /** The worker processed a document: if it is a task's file, its project may move on. */
    async documentScanned(documentId: string): Promise<void> {
      const projectId = await projects.projectOfDocument(documentId);
      if (!projectId) return;
      const record = await sync(projectId);
      if (record) await leaderboard?.forEventDates(record.targetDate);
    },

    /** One organization's projects that are not completed (before creating or listing). */
    async syncOrganization(organizationId: string): Promise<number> {
      return syncEach(await projects.listOpenIds(organizationId));
    },

    /** Every project that is not completed (the hourly job). Returns how many were checked. */
    async syncAll(): Promise<number> {
      return syncEach(await projects.listOpenIds());
    },
  };
}

export type ProjectSync = ReturnType<typeof createProjectSync>;
