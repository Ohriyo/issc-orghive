import type {
  Prisma,
  ProjectStatus,
  ProjectTaskStatus,
  ProjectTaskType,
} from '#src/generated/prisma/client';
import { figuresSelect } from './financial-figures.repository';
import type { Db } from './prisma';

export const projectSelect = {
  id: true,
  organizationId: true,
  name: true,
  targetDate: true,
  location: true,
  beneficiaries: true,
  description: true,
  status: true,
  proposalDueAt: true,
  postEventDueAt: true,
  proposalDueOverride: true,
  postEventDueOverride: true,
  nomRequired: true,
  momRequired: true,
  communicationLetterRequired: true,
  attendanceSheetRequired: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  organization: { select: { id: true, slug: true, acronym: true, name: true, type: true } },
  tasks: {
    select: {
      id: true,
      type: true,
      status: true,
      dueAt: true,
      submittedAt: true,
      documentId: true,
      // System view of the task's file, for the unlock rules only. What a viewer may see of
      // it goes through the document repository's visibility filter.
      document: { select: { status: true, deletedAt: true, createdById: true } },
      // A multi-file task's files (Communication Letters, other pre-event documents).
      files: {
        orderBy: { createdAt: 'asc' },
        select: {
          label: true,
          documentId: true,
          createdAt: true,
          document: { select: { status: true, deletedAt: true, createdById: true } },
        },
      },
    },
  },
  /**
   * Extra files outside the checklist (spec 2C), oldest first. What a viewer may see of
   * them goes through the document repository's visibility filter.
   */
  extraFiles: {
    orderBy: { createdAt: 'asc' },
    select: { documentId: true },
  },
  /** The Financial Report's totals (spec 5D). */
  figures: { select: figuresSelect },
} satisfies Prisma.ProjectSelect;

export type ProjectRecord = Prisma.ProjectGetPayload<{ select: typeof projectSelect }>;
export type TaskRecord = ProjectRecord['tasks'][number];
export type TaskFileRecord = TaskRecord['files'][number];

export interface NewProject {
  organizationId: string;
  name: string;
  /** `YYYY-MM-DD`. */
  targetDate: string;
  location: string;
  beneficiaries: string;
  description: string;
  nomRequired: boolean;
  momRequired: boolean;
  communicationLetterRequired: boolean;
  attendanceSheetRequired: boolean;
  createdById: string;
  createdAt: Date;
}

export interface ProjectPatch {
  name?: string;
  targetDate?: string;
  location?: string;
  beneficiaries?: string;
  description?: string;
  nomRequired?: boolean;
  momRequired?: boolean;
  communicationLetterRequired?: boolean;
  attendanceSheetRequired?: boolean;
}

/** What the unlock rules decided, to store. */
export interface StoredPlan {
  status: ProjectStatus;
  proposalDueAt: Date;
  postEventDueAt: Date;
  tasks: { type: ProjectTaskType; status: ProjectTaskStatus; dueAt: Date | null }[];
}

/** A planned task as stored: the rules' `required` flag is not a column. */
const storedTask = ({ type, status, dueAt }: StoredPlan['tasks'][number]) => ({
  type,
  status,
  dueAt,
});

/** A DATE column from `YYYY-MM-DD` (stored as UTC midnight). */
const asDate = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`);

/**
 * Projects are not documents: who may read or change them is the org guards' job, and
 * every query here is scoped to undeleted projects of undeleted organizations.
 */
export function createProjectRepository(db: Db) {
  const live = {
    deletedAt: null,
    organization: { deletedAt: null },
  } satisfies Prisma.ProjectWhereInput;

  return {
    async create(input: NewProject, plan: StoredPlan): Promise<ProjectRecord> {
      const { targetDate, ...rest } = input;
      return db.project.create({
        data: {
          ...rest,
          targetDate: asDate(targetDate),
          status: plan.status,
          proposalDueAt: plan.proposalDueAt,
          postEventDueAt: plan.postEventDueAt,
          tasks: { create: plan.tasks.map(storedTask) },
        },
        select: projectSelect,
      });
    },

    findById(id: string): Promise<ProjectRecord | null> {
      return db.project.findFirst({ where: { id, ...live }, select: projectSelect });
    },

    /** The organization's projects, soonest event first. */
    listByOrganization(organizationId: string): Promise<ProjectRecord[]> {
      return db.project.findMany({
        where: { organizationId, ...live },
        orderBy: [{ targetDate: 'asc' }, { id: 'asc' }],
        select: projectSelect,
      });
    },

    /** The organization a project belongs to, for the org guards. Null when deleted. */
    async organizationOf(id: string): Promise<{ id: string; slug: string } | null> {
      const row = await db.project.findFirst({
        where: { id, ...live },
        select: { organization: { select: { id: true, slug: true } } },
      });
      return row?.organization ?? null;
    },

    async update(id: string, patch: ProjectPatch): Promise<void> {
      const { targetDate, ...rest } = patch;
      await db.project.update({
        where: { id },
        data: { ...rest, ...(targetDate && { targetDate: asDate(targetDate) }) },
      });
    },

    /**
     * Stores what the rules decided: the project's status and deadlines, every planned task
     * (created when missing), and removes tasks no longer needed (an unticked pre-event
     * document without a file). Stamps `submittedAt` on tasks that just became submitted.
     *
     * Returns the status it replaced when this call changed it, else null. The status
     * changes through a conditional update, so when two checks race (the hourly job and a
     * read) exactly one sees the change, and a block is audited and announced once.
     */
    async applyPlan(id: string, plan: StoredPlan, now: Date): Promise<ProjectStatus | null> {
      return db.$transaction(async (tx) => {
        const before = await tx.project.findUniqueOrThrow({
          where: { id },
          select: { status: true },
        });
        const changed = await tx.project.updateMany({
          where: { id, status: { not: plan.status } },
          data: { status: plan.status },
        });
        await tx.project.update({
          where: { id },
          data: { proposalDueAt: plan.proposalDueAt, postEventDueAt: plan.postEventDueAt },
        });
        const existing = await tx.projectTask.findMany({
          where: { projectId: id },
          select: { type: true, submittedAt: true, documentId: true },
        });
        const byType = new Map(existing.map((t) => [t.type, t]));
        for (const task of plan.tasks) {
          const before = byType.get(task.type);
          const submittedAt = task.status === 'submitted' ? (before?.submittedAt ?? now) : null;
          await tx.projectTask.upsert({
            where: { projectId_type: { projectId: id, type: task.type } },
            create: { projectId: id, ...storedTask(task), submittedAt },
            update: { status: task.status, dueAt: task.dueAt, submittedAt },
          });
        }
        const planned = plan.tasks.map((t) => t.type);
        await tx.projectTask.deleteMany({
          where: { projectId: id, type: { notIn: planned }, documentId: null, files: { none: {} } },
        });
        return changed.count === 1 ? before.status : null;
      });
    },

    /** Links a task to its file; a task holds one document, re-uploads are its versions. */
    async linkDocument(
      projectId: string,
      type: ProjectTaskType,
      documentId: string,
    ): Promise<void> {
      await db.projectTask.update({
        where: { projectId_type: { projectId, type } },
        data: { documentId },
      });
    },

    /**
     * Adds a file to a multi-file task (a Communication Letter, another pre-event document),
     * creating the task row when the project has none yet (projects completed before the
     * task existed).
     */
    async addTaskFile(
      projectId: string,
      type: ProjectTaskType,
      documentId: string,
      label: string,
    ): Promise<void> {
      await db.projectTask.upsert({
        where: { projectId_type: { projectId, type } },
        create: { projectId, type, status: 'open', files: { create: { documentId, label } } },
        update: { files: { create: { documentId, label } } },
      });
    },

    /** Links a new Paperworks document to the project as an extra file (spec 2C). */
    async addProjectFile(projectId: string, documentId: string): Promise<void> {
      await db.projectFile.create({ data: { projectId, documentId } });
    },

    /** The project a document is a task file of (one-file or multi-file task), if any. */
    async projectOfDocument(documentId: string): Promise<string | null> {
      const task = await db.projectTask.findFirst({
        where: { OR: [{ documentId }, { files: { some: { documentId } } }] },
        select: { projectId: true },
      });
      return task?.projectId ?? null;
    },

    /** The target date of the project whose task holds this file; null for other files. */
    async targetDateOfDocument(documentId: string): Promise<Date | null> {
      const task = await db.projectTask.findFirst({
        where: { OR: [{ documentId }, { files: { some: { documentId } } }] },
        select: { project: { select: { targetDate: true } } },
      });
      return task?.project.targetDate ?? null;
    },

    /**
     * Projects whose checklist can still change with time: not completed. Of one
     * organization when given (the check on read), else all of them (the hourly job).
     */
    async listOpenIds(organizationId?: string): Promise<string[]> {
      const rows = await db.project.findMany({
        where: { ...live, status: { not: 'completed' }, ...(organizationId && { organizationId }) },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
  };
}

export type ProjectRepository = ReturnType<typeof createProjectRepository>;
