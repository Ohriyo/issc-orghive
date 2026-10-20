import type { Prisma } from '#src/generated/prisma/client';
import type { Db } from './prisma';

export const figuresSelect = {
  incomeCentavos: true,
  expensesCentavos: true,
  flaggedAt: true,
  flagRemark: true,
  updatedAt: true,
} satisfies Prisma.FinancialFiguresSelect;

export type FiguresRecord = Prisma.FinancialFiguresGetPayload<{ select: typeof figuresSelect }>;

export interface FiguresAmounts {
  incomeCentavos: number;
  expensesCentavos: number;
}

/** `YYYY-MM-DD`, inclusive: a semester (semesterRange). */
export interface DateRange {
  start: string;
  end: string;
}

const asDate = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`);

/**
 * A Financial Report's totals (docs/PROJECT_WORKFLOW_SPEC.md, section 5D), one row per
 * project. Who may write them is the org guards' and the service's job.
 */
export function createFinancialFiguresRepository(db: Db) {
  return {
    findByProject(projectId: string): Promise<FiguresRecord | null> {
      return db.financialFigures.findUnique({ where: { projectId }, select: figuresSelect });
    },

    /** Stores the totals; returns what they replaced (null on the first entry) and the result. */
    async save(
      projectId: string,
      amounts: FiguresAmounts,
    ): Promise<{ before: FiguresRecord | null; after: FiguresRecord }> {
      return db.$transaction(async (tx) => {
        const before = await tx.financialFigures.findUnique({
          where: { projectId },
          select: figuresSelect,
        });
        const after = await tx.financialFigures.upsert({
          where: { projectId },
          create: { projectId, ...amounts },
          update: amounts,
          select: figuresSelect,
        });
        return { before, after };
      });
    },

    /** Puts the figures under review (or replaces the remark). Null when there are none. */
    async flag(
      projectId: string,
      flag: { remark: string; flaggedById: string; at: Date },
    ): Promise<FiguresRecord | null> {
      const { count } = await db.financialFigures.updateMany({
        where: { projectId },
        data: { flaggedAt: flag.at, flagRemark: flag.remark, flaggedById: flag.flaggedById },
      });
      return count === 0 ? null : this.findByProject(projectId);
    },

    /** Clears the flag. True when this call cleared it (it was set). */
    async clearFlag(projectId: string): Promise<boolean> {
      const { count } = await db.financialFigures.updateMany({
        where: { projectId, flaggedAt: { not: null } },
        data: { flaggedAt: null, flagRemark: null, flaggedById: null },
      });
      return count === 1;
    },

    /**
     * The figures of every project in the range (by target date) whose Financial Report is
     * submitted, of undeleted projects and organizations: what the ISSC checks.
     */
    listSubmitted(range: DateRange) {
      return db.financialFigures.findMany({
        where: {
          project: {
            deletedAt: null,
            organization: { deletedAt: null },
            targetDate: { gte: asDate(range.start), lte: asDate(range.end) },
            tasks: {
              some: {
                type: 'FINANCIAL_REPORT',
                submittedAt: { not: null },
                document: { deletedAt: null, status: { in: ['available', 'archived'] } },
              },
            },
          },
        },
        orderBy: [{ project: { targetDate: 'asc' } }, { projectId: 'asc' }],
        select: {
          ...figuresSelect,
          projectId: true,
          project: {
            select: {
              name: true,
              targetDate: true,
              organization: { select: { slug: true, acronym: true, name: true } },
            },
          },
        },
      });
    },
  };
}

export type FinancialFiguresRepository = ReturnType<typeof createFinancialFiguresRepository>;
