import { Prisma, type Semester } from '#src/generated/prisma/client';
import type { Db } from './prisma';

const reportSelect = {
  id: true,
  organizationId: true,
  academicYear: true,
  semester: true,
  status: true,
  progress: true,
  error: true,
  requestedById: true,
  createdAt: true,
  finishedAt: true,
  requestedBy: { select: { name: true } },
  document: { select: { id: true, title: true, deletedAt: true, currentVersionId: true } },
} satisfies Prisma.SemestralReportSelect;

export type ReportRecord = Prisma.SemestralReportGetPayload<{ select: typeof reportSelect }>;

/** A task file counts once it is clean: available or archived, not deleted. */
const filedDocument = {
  deletedAt: null,
  status: { in: ['available', 'archived'] },
} satisfies Prisma.DocumentWhereInput;

const reportProjectSelect = {
  id: true,
  name: true,
  targetDate: true,
  location: true,
  beneficiaries: true,
  nomRequired: true,
  momRequired: true,
  communicationLetterRequired: true,
  attendanceSheetRequired: true,
  tasks: {
    where: { OR: [{ document: filedDocument }, { files: { some: { document: filedDocument } } }] },
    select: {
      type: true,
      document: {
        select: {
          currentVersion: { select: { storageKey: true, mimeType: true, scanStatus: true } },
        },
      },
      // Multi-file tasks: every filed letter or other document, oldest first.
      files: {
        where: { document: filedDocument },
        orderBy: { createdAt: 'asc' },
        select: {
          label: true,
          document: {
            select: {
              currentVersion: { select: { storageKey: true, mimeType: true, scanStatus: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ProjectSelect;

export type ReportProjectRecord = Prisma.ProjectGetPayload<{ select: typeof reportProjectSelect }>;

const reportOrgSelect = {
  id: true,
  slug: true,
  acronym: true,
  name: true,
  type: true,
  college: { select: { name: true } },
} satisfies Prisma.OrganizationSelect;

export type ReportOrgRecord = Prisma.OrganizationGetPayload<{ select: typeof reportOrgSelect }>;

/** A DATE column from `YYYY-MM-DD` (stored as UTC midnight). */
const asDate = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`);

/**
 * Semestral End Reports (docs/PROJECT_WORKFLOW_SPEC.md, section 4). The generated PDF itself
 * is an ordinary document; this is the request and its progress.
 */
export function createReportRepository(db: Db) {
  return {
    /** Queues a report; 'running' when one for that semester is already queued or running. */
    async create(input: {
      organizationId: string;
      academicYear: string;
      semester: Semester;
      requestedById: string;
    }): Promise<{ status: 'created'; report: ReportRecord } | { status: 'running' }> {
      try {
        const report = await db.semestralReport.create({ data: input, select: reportSelect });
        return { status: 'created', report };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return { status: 'running' };
        }
        throw err;
      }
    },

    findById(id: string): Promise<ReportRecord | null> {
      return db.semestralReport.findUnique({ where: { id }, select: reportSelect });
    },

    /** The organization's latest reports, newest first. */
    listByOrganization(organizationId: string, take = 10): Promise<ReportRecord[]> {
      return db.semestralReport.findMany({
        where: { organizationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        select: reportSelect,
      });
    },

    /** queued (or a previous attempt's generating) -> generating. False once it finished. */
    async start(id: string, at: Date): Promise<boolean> {
      const updated = await db.semestralReport.updateMany({
        where: { id, status: { in: ['queued', 'generating'] } },
        data: { status: 'generating', startedAt: at, progress: 0, error: null },
      });
      return updated.count === 1;
    },

    /** Moves progress forward only, while generating. */
    async setProgress(id: string, progress: number): Promise<void> {
      await db.semestralReport.updateMany({
        where: { id, status: 'generating', progress: { lt: progress } },
        data: { progress },
      });
    },

    async finish(id: string, documentId: string, at: Date): Promise<void> {
      await db.semestralReport.update({
        where: { id },
        data: { status: 'ready', progress: 100, documentId, finishedAt: at },
      });
    },

    async fail(id: string, error: string, at: Date): Promise<void> {
      await db.semestralReport.update({
        where: { id },
        data: { status: 'failed', error, finishedAt: at },
      });
    },

    findOrganization(id: string): Promise<ReportOrgRecord | null> {
      return db.organization.findFirst({ where: { id, deletedAt: null }, select: reportOrgSelect });
    },

    /** Undeleted projects whose target date is in [start, end], with their clean task files. */
    projectsBetween(
      organizationId: string,
      start: string,
      end: string,
    ): Promise<ReportProjectRecord[]> {
      return db.project.findMany({
        where: {
          organizationId,
          deletedAt: null,
          targetDate: { gte: asDate(start), lte: asDate(end) },
        },
        orderBy: [{ targetDate: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        select: reportProjectSelect,
      });
    },
  };
}

export type ReportRepository = ReturnType<typeof createReportRepository>;
