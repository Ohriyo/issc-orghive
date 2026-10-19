import {
  APPEAL_TYPE_LABELS,
  endOfManilaDay,
  type Appeal,
  type AppealAttachment,
  type AppealListResponse,
  type AppealQueueQuery,
  type AttachmentDownloadResponse,
  type DecideAppealRequest,
  type OrganizationCompliance,
  type SubmitAppeal,
  type UploadUrlRequest,
  type UploadUrlResponse,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import type { AttachmentQueue } from '#src/lib/queue';
import type { Storage } from '#src/lib/storage';
import type {
  AppealRecord,
  AppealRepository,
  AppellantRecord,
  AttachmentRecord,
} from '#src/repositories/appeal.repository';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { Account, AccountRepository } from '#src/repositories/account.repository';
import type { OrgFreezeRepository } from '#src/repositories/org-freeze.repository';
import type { ProjectRepository } from '#src/repositories/project.repository';
import type { OrgRef } from './access.service';
import { decisionAuthority, type AppellantOrg, type DecisionAuthority } from './appeal-rules';
import type { Actor } from './document.service';
import type { NotificationService } from './notification.service';
import { deadlinesAfterApproval } from './project-rules';
import type { ProjectSync } from './project-sync.service';
import type { Recipients } from './recipients.service';
import { UPLOAD_URL_TTL_SECONDS, type UploadService } from './upload.service';

export interface AppealServiceDeps {
  appeals: AppealRepository;
  projects: Pick<ProjectRepository, 'findById' | 'listByOrganization'>;
  freezes: Pick<OrgFreezeRepository, 'findById' | 'listOpen'>;
  sync: Pick<ProjectSync, 'sync' | 'syncOrganization'>;
  accounts: Pick<AccountRepository, 'findAccount'>;
  recipients: Pick<Recipients, 'officersOf' | 'decidersOf'>;
  notifications: Pick<NotificationService, 'notify'>;
  uploads: Pick<UploadService, 'issueUrl' | 'claim'>;
  queue: AttachmentQueue;
  storage: Pick<Storage, 'presignGet'>;
  audit: Pick<AuditLogRepository, 'record'>;
  now?: () => Date;
}

const appellantOf = (org: AppellantRecord): AppellantOrg => ({
  id: org.id,
  type: org.type,
  parentId: org.parentId,
});

/** The organization whose account decides: the parent (appeal-rules.ts). */
function deciderBrief(org: AppellantRecord) {
  const decider = org.parent ?? org;
  return { type: decider.type, slug: decider.slug, acronym: decider.acronym, name: decider.name };
}

/** Who to name in a 403, e.g. "the CSC-CEA account". */
function seatName(org: AppellantRecord): string {
  if (org.type === 'ISSC') return 'nobody (the ISSC does not appeal)';
  return `the ${org.parent?.acronym ?? 'parent council'} account`;
}

function toAttachment(a: AttachmentRecord): AppealAttachment {
  return {
    id: a.id,
    filename: a.originalFilename,
    contentType: a.mimeType,
    sizeBytes: a.sizeBytes,
    scanStatus: a.scanStatus,
  };
}

/**
 * Appeals (docs/PROJECT_WORKFLOW_SPEC.md, section 3): the only approvals in Orghive.
 * Officers appeal a blocked project or a freeze of their organization; the head of the body
 * above decides (appeal-rules.ts, enforced here on every decision). Approving sets a new
 * deadline and unblocks or unfreezes; rejecting keeps the block with the remarks shown,
 * and the organization may appeal again. Every step is audited and notified.
 */
export function createAppealService({
  appeals,
  projects,
  freezes,
  sync,
  accounts,
  recipients,
  notifications,
  uploads,
  queue,
  storage,
  audit,
  now = () => new Date(),
}: AppealServiceDeps) {
  /** The actor's authority over one appellant's appeals; the vacancy check is lazy. */
  async function authorityOver(
    actor: Account | null,
    org: AppellantRecord,
    seatCache?: Map<string, boolean>,
  ): Promise<DecisionAuthority | null> {
    const appellant = appellantOf(org);
    const actorOrg = actor?.organization ?? null;
    // Only the ISSC account's override depends on whether the deciding seat is vacant.
    const seated = decisionAuthority(appellant, actorOrg, false);
    if (seated) return seated;
    if (actorOrg?.type !== 'ISSC') return null;
    let filled = seatCache?.get(org.id);
    if (filled === undefined) {
      filled = (await recipients.decidersOf(appellant)).seatFilled;
      seatCache?.set(org.id, filled);
    }
    return decisionAuthority(appellant, actorOrg, !filled);
  }

  function toAppeal(rec: AppealRecord, canDecide: boolean): Appeal {
    const org = rec.organization;
    return {
      id: rec.id,
      type: rec.type,
      status: rec.status,
      reason: rec.reason,
      remarks: rec.remarks,
      newDueAt: rec.newDueAt?.toISOString() ?? null,
      submittedAt: rec.createdAt.toISOString(),
      decidedAt: rec.decidedAt?.toISOString() ?? null,
      submittedBy: { name: rec.submittedBy.name },
      decidedBy: rec.decidedBy && { name: rec.decidedBy.name },
      organization: { type: org.type, slug: org.slug, acronym: org.acronym, name: org.name },
      decider: deciderBrief(org),
      project: {
        id: rec.project.id,
        name: rec.project.name,
        targetDate: rec.project.targetDate.toISOString().slice(0, 10),
      },
      freeze: rec.freeze && { id: rec.freeze.id, reports: rec.freeze.reports },
      attachments: rec.attachments.map(toAttachment),
      canDecide: canDecide && rec.status === 'pending',
    };
  }

  async function loadAppellant(orgId: string): Promise<AppellantRecord> {
    const org = await appeals.findAppellant(orgId);
    if (!org) throw AppError.notFound('Organization not found');
    return org;
  }

  /** The attachments named in an appeal: this organization's clean, unused files. */
  async function checkAttachments(org: OrgRef, ids: string[]) {
    if (ids.length === 0) return;
    const found = new Map((await appeals.findAttachments(ids)).map((a) => [a.id, a]));
    for (const id of ids) {
      const a = found.get(id);
      if (!a || a.organizationId !== org.id) throw AppError.notFound('Attachment not found');
      if (a.appealId)
        throw AppError.conflict(`${a.originalFilename} is already part of an appeal.`);
      if (a.scanStatus === 'pending') {
        throw AppError.conflict(
          `${a.originalFilename} is still being checked for viruses. Submit once it is done.`,
        );
      }
      if (a.scanStatus !== 'clean') {
        throw AppError.conflict(
          `The virus scan refused ${a.originalFilename}. Remove it and attach a clean copy.`,
        );
      }
    }
  }

  return {
    /**
     * What the dashboard banner shows: open freezes and blocked projects, each with its
     * pending appeal or last rejection. Runs the compliance check first (check on read).
     */
    async compliance(org: OrgRef): Promise<OrganizationCompliance> {
      await sync.syncOrganization(org.id);
      const [appellant, open, records, history] = await Promise.all([
        loadAppellant(org.id),
        freezes.listOpen(org.id),
        projects.listByOrganization(org.id),
        appeals.listByOrganization(org.id),
      ]);
      // Newest first: the latest appeal says whether one is pending or was just rejected.
      const latest = (match: (a: AppealRecord) => boolean) => {
        const a = history.find(match);
        return {
          pendingAppeal:
            a?.status === 'pending' ? { id: a.id, submittedAt: a.createdAt.toISOString() } : null,
          lastRejection:
            a?.status === 'rejected' && a.remarks && a.decidedAt
              ? { remarks: a.remarks, decidedAt: a.decidedAt.toISOString() }
              : null,
        };
      };
      return {
        frozen: open.length > 0,
        freezes: open.map((f) => ({
          id: f.id,
          project: { id: f.project.id, name: f.project.name },
          reports: f.reports,
          frozenAt: f.frozenAt.toISOString(),
          ...latest((a) => a.freeze?.id === f.id),
        })),
        blockedProjects: records
          .filter((p) => p.status === 'blocked')
          .map((p) => ({
            id: p.id,
            name: p.name,
            proposalDueAt: p.proposalDueAt.toISOString(),
            ...latest((a) => a.type === 'PROJECT_BLOCK' && a.project.id === p.id),
          })),
        decider: deciderBrief(appellant),
      };
    },

    /** A project's appeal history, newest first (the project page). */
    async listForProject(
      actor: Actor,
      org: OrgRef,
      projectId: string,
    ): Promise<AppealListResponse> {
      const project = await projects.findById(projectId);
      if (!project || project.organizationId !== org.id)
        throw AppError.notFound('Project not found');
      const [records, active] = await Promise.all([
        appeals.listByOrganization(org.id, projectId),
        accounts.findAccount(actor.userId),
      ]);
      const cache = new Map<string, boolean>();
      const items: Appeal[] = [];
      for (const rec of records) {
        const authority = await authorityOver(active, rec.organization, cache);
        items.push(toAppeal(rec, !!authority && rec.submittedById !== actor.userId));
      }
      return { items };
    },

    /**
     * The organization's account appeals one of its blocked projects or an open freeze, with a
     * reason and optional clean attachments. One pending appeal per block or freeze.
     */
    async submit(actor: Actor, org: OrgRef, input: SubmitAppeal): Promise<Appeal> {
      const appellant = await loadAppellant(org.id);
      let projectId: string;
      let freezeId: string | null = null;
      if (input.type === 'PROJECT_BLOCK') {
        const project = await sync.sync(input.projectId);
        if (!project || project.organizationId !== org.id) {
          throw AppError.notFound('Project not found');
        }
        if (project.status !== 'blocked') {
          throw AppError.conflict('This project is not blocked, so there is nothing to appeal.');
        }
        projectId = project.id;
      } else {
        const freeze = await freezes.findById(input.freezeId);
        if (!freeze || freeze.organizationId !== org.id)
          throw AppError.notFound('Freeze not found');
        if (freeze.liftedAt) throw AppError.conflict('This freeze was already lifted.');
        projectId = freeze.projectId;
        freezeId = freeze.id;
      }
      await checkAttachments(org, input.attachmentIds);

      const result = await appeals.create(
        {
          type: input.type,
          organizationId: org.id,
          projectId,
          freezeId,
          reason: input.reason,
          submittedById: actor.userId,
          createdAt: now(),
        },
        input.attachmentIds,
      );
      if (result.status === 'duplicate') {
        throw AppError.conflict('An appeal for this is already waiting for a decision.');
      }
      if (result.status === 'attachments') {
        throw AppError.conflict('An attachment is no longer available. Attach it again.');
      }
      const appeal = result.appeal;
      await audit.record({
        action: 'appeal_submit',
        actorId: actor.userId,
        entityType: 'appeal',
        entityId: appeal.id,
        organizationId: org.id,
        metadata: {
          type: input.type,
          projectId,
          freezeId,
          attachments: input.attachmentIds.length,
        },
        ip: actor.ip,
      });
      const deciders = await recipients.decidersOf(appellantOf(appellant));
      await notifications.notify({
        userIds: deciders.userIds,
        kind: 'appeal_submitted',
        title: `${appellant.acronym} appealed: ${APPEAL_TYPE_LABELS[input.type].toLowerCase()}`,
        body: `${appellant.acronym} submitted an appeal about ${appeal.project.name}. It is waiting for your decision.`,
        link: '/dashboard/appeals',
        dedupeKey: `appeal-submitted:${appeal.id}`,
      });
      return toAppeal(appeal, false);
    },

    /** Pending appeals the user may decide now, or the ones they decided. */
    async queue(actor: Actor, query: AppealQueueQuery): Promise<AppealListResponse> {
      if (query.status === 'decided') {
        const decided = await appeals.listDecidedBy(actor.userId);
        return { items: decided.map((rec) => toAppeal(rec, false)) };
      }
      const [pending, active] = await Promise.all([
        appeals.listPending(),
        accounts.findAccount(actor.userId),
      ]);
      const cache = new Map<string, boolean>();
      const items: Appeal[] = [];
      for (const rec of pending) {
        if (rec.submittedById === actor.userId) continue;
        if (await authorityOver(active, rec.organization, cache)) items.push(toAppeal(rec, true));
      }
      return { items };
    },

    /**
     * Approve (new due date: unblock or unfreeze) or reject (remarks; stays blocked). Only
     * the account appeal-rules.ts names may decide, or the ISSC account while it is vacant
     * (audited). Never one's own appeal.
     */
    async decide(actor: Actor, appealId: string, input: DecideAppealRequest): Promise<Appeal> {
      const rec = await appeals.findById(appealId);
      if (!rec) throw AppError.notFound('Appeal not found');
      const active = await accounts.findAccount(actor.userId);
      const authority = await authorityOver(active, rec.organization);
      if (!authority) {
        throw AppError.forbidden(`Only ${seatName(rec.organization)} decides this appeal.`);
      }
      if (rec.submittedById === actor.userId) {
        throw AppError.forbidden('You cannot decide an appeal you submitted.');
      }
      if (rec.status !== 'pending') throw AppError.conflict('This appeal was already decided.');
      if (rec.project.deletedAt) throw AppError.conflict('The project of this appeal was deleted.');

      const decidedAt = now();
      const base = { decidedById: actor.userId, decidedAt };
      const orgId = rec.organization.id;
      let ok: boolean;
      if (input.decision === 'approve') {
        const newDueAt = endOfManilaDay(input.newDueDate);
        ok = await appeals.approve(
          rec.id,
          { ...base, remarks: input.remarks ?? null, newDueAt },
          {
            projectId: rec.project.id,
            overrides: deadlinesAfterApproval(rec.type, rec.project, newDueAt),
            liftFreezeId: rec.type === 'ORG_FREEZE' ? (rec.freeze?.id ?? null) : null,
          },
        );
        if (ok) {
          await audit.record({
            action: 'approve',
            actorId: actor.userId,
            entityType: 'appeal',
            entityId: rec.id,
            organizationId: orgId,
            metadata: { type: rec.type, newDueAt: newDueAt.toISOString(), authority },
            ip: actor.ip,
          });
          if (rec.type === 'ORG_FREEZE' && rec.freeze) {
            await audit.record({
              action: 'org_unfreeze',
              actorId: actor.userId,
              entityType: 'org_freeze',
              entityId: rec.freeze.id,
              organizationId: orgId,
              metadata: { appealId: rec.id, postEventDueAt: newDueAt.toISOString() },
              ip: actor.ip,
            });
          }
          // Applies the new deadline now; an unblock is audited by the compliance hooks.
          await sync.sync(rec.project.id);
        }
      } else {
        ok = await appeals.reject(rec.id, { ...base, remarks: input.remarks });
        if (ok) {
          await audit.record({
            action: 'reject',
            actorId: actor.userId,
            entityType: 'appeal',
            entityId: rec.id,
            organizationId: orgId,
            metadata: { type: rec.type, authority },
            ip: actor.ip,
          });
        }
      }
      if (!ok) throw AppError.conflict('This appeal was already decided.');
      if (authority === 'admin_override') {
        await audit.record({
          action: 'admin_override',
          actorId: actor.userId,
          entityType: 'appeal',
          entityId: rec.id,
          organizationId: orgId,
          metadata: { required: 'appeal_decider', decision: input.decision, seat: 'vacant' },
          ip: actor.ip,
        });
      }

      const officers = await recipients.officersOf(orgId);
      const approved = input.decision === 'approve';
      await notifications.notify({
        userIds: [...officers, rec.submittedById],
        kind: 'appeal_decided',
        title: `Appeal ${approved ? 'approved' : 'rejected'}: ${rec.project.name}`,
        body: approved
          ? `${deciderBrief(rec.organization).acronym} approved your appeal about ${rec.project.name}. The new deadline is ${input.newDueDate}.${input.remarks ? ` Remarks: ${input.remarks}` : ''}`
          : `${deciderBrief(rec.organization).acronym} rejected your appeal about ${rec.project.name}. Remarks: ${input.remarks} You can appeal again.`,
        link: `/projects/${rec.project.id}`,
        dedupeKey: `appeal-decided:${rec.id}`,
      });

      const updated = await appeals.findById(rec.id);
      return toAppeal(updated!, false);
    },

    /** A pre-signed PUT for a supporting file (any allowed upload type). */
    attachmentUploadUrl(
      actor: Actor,
      org: OrgRef,
      file: UploadUrlRequest,
    ): Promise<UploadUrlResponse> {
      return uploads.issueUrl(actor.userId, org, file);
    },

    /** Claims an uploaded file as an attachment and queues its virus scan. */
    async addAttachment(actor: Actor, org: OrgRef, uploadKey: string): Promise<AppealAttachment> {
      const file = await uploads.claim(actor.userId, org, uploadKey);
      const rec = await appeals.createAttachment({
        organizationId: org.id,
        uploadedById: actor.userId,
        storageKey: file.storageKey,
        originalFilename: file.originalFilename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
      });
      await queue.enqueueAttachmentScan(rec.id);
      return toAttachment(rec);
    },

    /** An attachment's scan status, while the form waits for it. */
    async getAttachment(org: OrgRef, attachmentId: string): Promise<AppealAttachment> {
      const rec = await appeals.findAttachment(attachmentId);
      if (!rec || rec.organizationId !== org.id) throw AppError.notFound('Attachment not found');
      return toAttachment(rec);
    },

    /**
     * A 5-minute download link for a clean attachment, for the appealing organization's
     * account and the account that decides the appeal (the ISSC while that seat is vacant:
     * audited override). Everyone else gets a 404. Every download is audited.
     */
    async attachmentDownload(
      actor: Actor,
      appealId: string,
      attachmentId: string,
    ): Promise<AttachmentDownloadResponse> {
      const rec = await appeals.findById(appealId);
      const attachment = rec?.attachments.find((a) => a.id === attachmentId);
      if (!rec || !attachment) throw AppError.notFound('Attachment not found');
      const active = await accounts.findAccount(actor.userId);
      const orgId = rec.organization.id;
      const isOwn = active?.organization.id === orgId;
      const authority = isOwn ? null : await authorityOver(active, rec.organization);
      const access = isOwn
        ? 'organization'
        : authority === 'seat'
          ? 'decider'
          : authority === 'admin_override'
            ? 'admin_override'
            : null;
      if (!access) throw AppError.notFound('Attachment not found');
      if (attachment.scanStatus !== 'clean') {
        throw AppError.conflict('This file did not pass the virus scan and cannot be opened.');
      }
      const url = await storage.presignGet(
        attachment.storageKey,
        {
          filename: attachment.originalFilename,
          contentType: attachment.mimeType,
          disposition: 'attachment',
        },
        UPLOAD_URL_TTL_SECONDS,
      );
      await audit.record({
        action: 'appeal_attachment_view',
        actorId: actor.userId,
        entityType: 'appeal_attachment',
        entityId: attachment.id,
        organizationId: orgId,
        metadata: { appealId, access },
        ip: actor.ip,
      });
      if (access === 'admin_override') {
        await audit.record({
          action: 'admin_override',
          actorId: actor.userId,
          entityType: 'appeal_attachment',
          entityId: attachment.id,
          organizationId: orgId,
          metadata: { required: 'appeal_party', access: 'download', appealId },
          ip: actor.ip,
        });
      }
      const expiresAt = new Date(now().getTime() + UPLOAD_URL_TTL_SECONDS * 1000);
      return { url, expiresAt: expiresAt.toISOString() };
    },
  };
}

export type AppealService = ReturnType<typeof createAppealService>;
