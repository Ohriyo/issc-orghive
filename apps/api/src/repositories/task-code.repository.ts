import { Prisma, type ProjectTaskType } from '#src/generated/prisma/client';
import type { Db } from './prisma';

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/** What a task's template is filled with (lib/task-template.ts). */
const templateSelect = {
  id: true,
  project: {
    select: {
      name: true,
      targetDate: true,
      location: true,
      beneficiaries: true,
      organizationId: true,
      deletedAt: true,
      organization: {
        select: { name: true, acronym: true, type: true, college: { select: { name: true } } },
      },
    },
  },
} satisfies Prisma.ProjectTaskSelect;

export type TemplateTaskRecord = Prisma.ProjectTaskGetPayload<{ select: typeof templateSelect }>;

export interface TaskCodeRecord {
  id: string;
  taskId: string;
  code: string;
  label: string | null;
  taskFileId: string | null;
}

const codeSelect = {
  id: true,
  taskId: true,
  code: true,
  label: true,
  taskFileId: true,
} satisfies Prisma.TaskCodeSelect;

/** Short codes and QR codes of project tasks (docs/PROJECT_WORKFLOW_SPEC.md, section 6). */
export function createTaskCodeRepository(db: Db) {
  return {
    /** A project's task of this type, with what its template shows; null without one. */
    findTemplateTask(projectId: string, type: ProjectTaskType): Promise<TemplateTaskRecord | null> {
      return db.projectTask.findUnique({
        where: { projectId_type: { projectId, type } },
        select: templateSelect,
      });
    },

    /** A one-file task's code, the first one made. */
    findForTask(taskId: string): Promise<TaskCodeRecord | null> {
      return db.taskCode.findFirst({
        where: { taskId },
        orderBy: { createdAt: 'asc' },
        select: codeSelect,
      });
    },

    findByCode(code: string): Promise<TaskCodeRecord | null> {
      return db.taskCode.findUnique({ where: { code }, select: codeSelect });
    },

    /**
     * Stores a new code, drawing another while the drawn one is taken (the codes' random part
     * is short so people can type it). Gives up after a few clashes, which only a nearly full
     * code space would cause.
     */
    async create(
      input: { taskId: string; label: string | null },
      draw: () => string,
    ): Promise<TaskCodeRecord> {
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          return await db.taskCode.create({
            data: { taskId: input.taskId, label: input.label, code: draw() },
            select: codeSelect,
          });
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
        }
      }
      throw new Error('Could not draw a free task code');
    },
  };
}

export type TaskCodeRepository = ReturnType<typeof createTaskCodeRepository>;
