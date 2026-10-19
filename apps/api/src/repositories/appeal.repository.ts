import { Prisma, type AppealType, type ScanStatus } from '#src/generated/prisma/client';
import type { Db } from './prisma';

const orgBrief = { type: true, slug: true, acronym: true, name: true } as const;

/** The appealing organization, with its parent (the CSC or ISSC above it). */
const appellantSelect = {
  id: true,
  parentId: true,
  ...orgBrief,
  parent: { select: { id: true, ...orgBrief } },
} satisfies Prisma.OrganizationSelect;

export type AppellantRecord = Prisma.OrganizationGetPayload<{ select: typeof appellantSelect }>;

const attachmentSelect = {
  id: true,
  organizationId: true,
  uploadedById: true,
  appealId: true,
  storageKey: true,
  originalFilename: true,
  mimeType: true,
  sizeBytes: true,
  scanStatus: true,
} satisfies Prisma.AppealAttachmentSelect;

export type AttachmentRecord = Prisma.AppealAttachmentGetPayload<{
  select: typeof attachmentSelect;
}>;

const appealSelect = {
  id: true,
  type: true,
  status: true,
  reason: true,
  remarks: true,
  newDueAt: true,
  decidedAt: true,
  createdAt: true,
  submittedById: true,
  decidedById: true,
  organization: { select: appellantSelect },
  project: {
    select: { id: true, name: true, targetDate: true, postEventDueAt: true, deletedAt: true },
  },
  freeze: { select: { id: true, reports: true, liftedAt: true } },
  submittedBy: { select: { name: true } },
  decidedBy: { select: { name: true } },
  attachments: { select: attachmentSelect, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.AppealSelect;

export type AppealRecord = Prisma.AppealGetPayload<{ select: typeof appealSelect }>;

export interface NewAppeal {
  type: AppealType;
  organizationId: string;
  projectId: string;
  freezeId: string | null;
  reason: string;
  submittedById: string;
  createdAt: Date;
}

export interface Decision {
  decidedById: string;
  decidedAt: Date;
  remarks: string | null;
}

/** What an approval changes besides the appeal, in the same transaction. */
export interface ApprovalEffects {
  projectId: string;
  overrides: { proposalDueOverride?: Date; postEventDueOverride?: Date };
  /** ORG_FREEZE: the freeze it lifts. */
  liftFreezeId: string | null;
}

export type CreateAppealResult =
  | { status: 'created'; appeal: AppealRecord }
  /** One is already pending for this block or freeze (partial unique index). */
  | { status: 'duplicate' }
  /** An attachment is not this organization's clean, unattached file. */
  | { status: 'attachments' };

class AttachmentsUnavailable extends Error {}

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/**
 * Appeals and their supporting files (docs/PROJECT_WORKFLOW_SPEC.md, section 3). Who may
 * see or decide them is the appeal service's job (appeal-rules.ts); attachments are not
 * documents and never go through the document visibility filter.
 */
export function createAppealRepository(db: Db) {
  return {
    findAppellant(organizationId: string): Promise<AppellantRecord | null> {
      return db.organization.findFirst({
        where: { id: organizationId, deletedAt: null },
        select: appellantSelect,
      });
    },

    /** Creates the appeal and attaches its files, all or nothing. */
    async create(input: NewAppeal, attachmentIds: string[]): Promise<CreateAppealResult> {
      try {
        const appeal = await db.$transaction(async (tx) => {
          const { id } = await tx.appeal.create({ data: input, select: { id: true } });
          if (attachmentIds.length > 0) {
            const claimed = await tx.appealAttachment.updateMany({
              where: {
                id: { in: attachmentIds },
                organizationId: input.organizationId,
                appealId: null,
                scanStatus: 'clean',
              },
              data: { appealId: id },
            });
            if (claimed.count !== attachmentIds.length) throw new AttachmentsUnavailable();
          }
          return tx.appeal.findUniqueOrThrow({ where: { id }, select: appealSelect });
        });
        return { status: 'created', appeal };
      } catch (err) {
        if (err instanceof AttachmentsUnavailable) return { status: 'attachments' };
        if (isUniqueViolation(err)) return { status: 'duplicate' };
        throw err;
      }
    },

    findById(id: string): Promise<AppealRecord | null> {
      return db.appeal.findUnique({ where: { id }, select: appealSelect });
    },

    /** An organization's appeals, newest first; of one project when given. */
    listByOrganization(organizationId: string, projectId?: string): Promise<AppealRecord[]> {
      return db.appeal.findMany({
        where: { organizationId, ...(projectId && { projectId }) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: appealSelect,
      });
    },

    /** Every pending appeal, oldest first. The service keeps those the user may decide. */
    listPending(): Promise<AppealRecord[]> {
      return db.appeal.findMany({
        where: { status: 'pending', project: { deletedAt: null } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: appealSelect,
      });
    },

    listDecidedBy(userId: string, take = 50): Promise<AppealRecord[]> {
      return db.appeal.findMany({
        where: { decidedById: userId },
        orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }],
        take,
        select: appealSelect,
      });
    },

    /**
     * Approves a pending appeal and applies what it changes: the new deadlines and, for a
     * freeze, lifting it. False when it was no longer pending (someone decided first).
     */
    async approve(
      id: string,
      decision: Decision & { newDueAt: Date },
      effects: ApprovalEffects,
    ): Promise<boolean> {
      return db.$transaction(async (tx) => {
        const decided = await tx.appeal.updateMany({
          where: { id, status: 'pending' },
          data: { status: 'approved', ...decision },
        });
        if (decided.count === 0) return false;
        await tx.project.update({ where: { id: effects.projectId }, data: effects.overrides });
        if (effects.liftFreezeId) {
          await tx.orgFreeze.updateMany({
            where: { id: effects.liftFreezeId, liftedAt: null },
            data: { liftedAt: decision.decidedAt },
          });
        }
        return true;
      });
    },

    /** Rejects a pending appeal. False when it was no longer pending. */
    async reject(id: string, decision: Decision & { remarks: string }): Promise<boolean> {
      const decided = await db.appeal.updateMany({
        where: { id, status: 'pending' },
        data: { status: 'rejected', ...decision },
      });
      return decided.count === 1;
    },

    createAttachment(input: {
      organizationId: string;
      uploadedById: string;
      storageKey: string;
      originalFilename: string;
      mimeType: string;
      sizeBytes: number;
    }): Promise<AttachmentRecord> {
      return db.appealAttachment.create({ data: input, select: attachmentSelect });
    },

    findAttachment(id: string): Promise<AttachmentRecord | null> {
      return db.appealAttachment.findUnique({ where: { id }, select: attachmentSelect });
    },

    findAttachments(ids: string[]): Promise<AttachmentRecord[]> {
      return db.appealAttachment.findMany({
        where: { id: { in: ids } },
        select: attachmentSelect,
      });
    },

    /** The worker's verdict. Only a pending file changes, so a retried job is harmless. */
    async markAttachmentScanned(
      id: string,
      scanStatus: Exclude<ScanStatus, 'pending'>,
      storageKey?: string,
    ): Promise<boolean> {
      const updated = await db.appealAttachment.updateMany({
        where: { id, scanStatus: 'pending' },
        data: { scanStatus, ...(storageKey && { storageKey }) },
      });
      return updated.count === 1;
    },
  };
}

export type AppealRepository = ReturnType<typeof createAppealRepository>;
