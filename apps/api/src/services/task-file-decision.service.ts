import {
  isCheckedTask,
  PROJECT_TASK_LABELS,
  type AttentionFile,
  type ClearTaskFileWarningsRequest,
  type FlagTaskFileRequest,
  type TaskFileDecisionResponse,
  type TaskFileIntegrityState,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { DocumentViewer } from '#src/repositories/document-visibility';
import type {
  DecisionRecord,
  TaskFileDecisionRepository,
} from '#src/repositories/task-file-decision.repository';
import type { RequestContext } from '#src/services/auth.service';
import type { DocumentViewerService } from '#src/services/document-viewer.service';
import { mayDecideIntegrity, taskFileStatus } from '#src/services/integrity-rules';
import type { LeaderboardRecompute } from '#src/services/leaderboard-recompute';
import type { NotificationService } from '#src/services/notification.service';
import type { Recipients } from '#src/services/recipients.service';

export interface TaskFileDecisionServiceDeps {
  decisions: TaskFileDecisionRepository;
  viewers: Pick<DocumentViewerService, 'forUser'>;
  recipients: Pick<Recipients, 'officersOf'>;
  notifications: Pick<NotificationService, 'notify'>;
  audit: Pick<AuditLogRepository, 'record'>;
  /** A cleared or flagged file moves the standings (spec 5 and section 6). */
  leaderboard?: Pick<LeaderboardRecompute, 'forEventDates'>;
  now?: () => Date;
}

/** Where a task file sits: its project, task and (for a letter) label. */
function placeOf(record: DecisionRecord) {
  const task = record.projectTask ?? record.taskFile?.task;
  if (!task || task.project.deletedAt) return null;
  return {
    project: task.project,
    type: task.type,
    label: record.taskFile?.label ?? null,
  };
}

/** "Letter to the Dean (Communication Letter)" or "Project Proposal". */
function fileName(place: NonNullable<ReturnType<typeof placeOf>>): string {
  const task = PROJECT_TASK_LABELS[place.type];
  return place.label ? `${place.label} (${task})` : task;
}

/** States a governing body may still flag: the file stands, and nobody flagged it yet. */
const FLAGGABLE: TaskFileIntegrityState[] = ['verified', 'needs_attention', 'legacy'];

/**
 * A task file's governing bodies decide on it (docs/PROJECT_WORKFLOW_SPEC.md, section 6):
 * they clear its warnings, so it counts as verified, or flag it invalid, so it no longer
 * counts until re-uploaded. Who may is mayDecideIntegrity (an SBO's college CSC or the
 * ISSC; a CSC's ISSC), never the organization itself; a private file is never found. The
 * file itself is never approved, hidden or changed: only whether it counts for ranking.
 */
export function createTaskFileDecisionService({
  decisions,
  viewers,
  recipients,
  notifications,
  audit,
  leaderboard,
  now = () => new Date(),
}: TaskFileDecisionServiceDeps) {
  /** The file and where it sits, for a governing body of its organization; else 404 or 403. */
  async function load(userId: string, documentId: string) {
    const viewer = await viewers.forUser(userId);
    const record =
      viewer.kind === 'account' ? await decisions.findForDecision(documentId, viewer) : null;
    const place = record && placeOf(record);
    if (!record || !place || !isCheckedTask(place.type) || viewer.kind !== 'account') {
      throw AppError.notFound('Task file not found');
    }
    // Only the viewer's own place matters to the rule; its parent never does.
    const actor = { id: viewer.organizationId, type: viewer.organizationType, parentId: null };
    if (!mayDecideIntegrity(actor, record.organization)) {
      throw AppError.forbidden(
        'Only the organization’s governing bodies (its CSC or the ISSC) decide on its task files',
      );
    }
    return { viewer, record, place, state: taskFileStatus(record) };
  }

  /** "Your CSC" or "The ISSC": who decided, as the organization reads it. */
  const deciderOf = (viewer: Extract<DocumentViewer, { kind: 'account' }>) =>
    viewer.organizationType === 'ISSC' ? 'The ISSC' : 'Your CSC';

  async function respond(userId: string, documentId: string): Promise<TaskFileDecisionResponse> {
    const viewer = await viewers.forUser(userId);
    const record = await decisions.findForDecision(documentId, viewer);
    const integrity = record && taskFileStatus(record);
    if (!integrity) throw AppError.notFound('Task file not found');
    return { documentId, integrity };
  }

  return {
    /** POST /task-files/:documentId/integrity/clear-warnings. */
    async clearWarnings(
      userId: string,
      documentId: string,
      input: ClearTaskFileWarningsRequest,
      ctx: RequestContext,
    ): Promise<TaskFileDecisionResponse> {
      const { viewer, record, place, state } = await load(userId, documentId);
      if (state?.state !== 'needs_attention' || !record.currentVersionId) {
        throw AppError.conflict(
          'Only a file whose checks warn, and is not flagged, can be cleared',
        );
      }
      const at = now();
      const versionId = record.currentVersionId;
      const note = input.note?.trim() || null;
      if (
        !(await decisions.clearWarnings(versionId, {
          byId: userId,
          actingAs: input.actingAs,
          note,
          at,
        }))
      ) {
        throw AppError.conflict('This file’s warnings were already cleared, or it was flagged');
      }
      await audit.record({
        action: 'task_file_clear_warnings',
        actorId: userId,
        entityType: 'document',
        entityId: documentId,
        organizationId: record.organization.id,
        metadata: { versionId, task: place.type, warnings: state.reasons, note },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        actingAs: input.actingAs,
      });
      await leaderboard?.forEventDates(place.project.targetDate);
      const userIds = await recipients.officersOf(record.organization.id);
      if (userIds.length > 0) {
        await notifications.notify({
          userIds,
          kind: 'task_file_checked',
          title: `Verified ✓: ${fileName(place)}, ${place.project.name}`,
          body: `${deciderOf(viewer)} looked at the warnings on this file and cleared them. It now counts as verified.${note ? ` They wrote: “${note}”` : ''}`,
          link: `/projects/${place.project.id}`,
          dedupeKey: `task-file-clear:${versionId}`,
        });
      }
      return respond(userId, documentId);
    },

    /** POST /task-files/:documentId/integrity/flag. */
    async flag(
      userId: string,
      documentId: string,
      input: FlagTaskFileRequest,
      ctx: RequestContext,
    ): Promise<TaskFileDecisionResponse> {
      const { viewer, record, place, state } = await load(userId, documentId);
      if (!state || !FLAGGABLE.includes(state.state) || !record.currentVersionId) {
        throw AppError.conflict(
          state?.state === 'flagged_invalid'
            ? 'This file is already flagged invalid'
            : 'Wait until the file is checked before flagging it',
        );
      }
      const at = now();
      const versionId = record.currentVersionId;
      const flagged = await decisions.flag(versionId, {
        byId: userId,
        actingAs: input.actingAs,
        reason: input.reason,
        at,
      });
      if (!flagged) throw AppError.conflict('This file is already flagged invalid');
      await audit.record({
        action: 'task_file_flag',
        actorId: userId,
        entityType: 'document',
        entityId: documentId,
        organizationId: record.organization.id,
        metadata: { versionId, task: place.type, reason: input.reason },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        actingAs: input.actingAs,
      });
      await leaderboard?.forEventDates(place.project.targetDate);
      const userIds = await recipients.officersOf(record.organization.id);
      if (userIds.length > 0) {
        await notifications.notify({
          userIds,
          kind: 'task_file_flagged',
          title: `Flagged invalid: ${fileName(place)}, ${place.project.name}`,
          body: `${deciderOf(viewer)} flagged this file as invalid: “${input.reason}” It still completes the task, but no longer counts for the leaderboard. Upload a corrected file on the task’s template.`,
          link: `/projects/${place.project.id}`,
          dedupeKey: `task-file-flag:${versionId}`,
        });
      }
      return respond(userId, documentId);
    },

    /**
     * The compliance overview's list (spec section 6): task files of these organizations'
     * projects in [start, end] that need attention or were flagged, by organization. Only
     * files the viewer may see, and never private ones.
     */
    async attentionFiles(
      viewer: DocumentViewer,
      orgIds: string[],
      start: string,
      end: string,
    ): Promise<Map<string, AttentionFile[]>> {
      const byOrg = new Map<string, AttentionFile[]>();
      if (viewer.kind !== 'account' || orgIds.length === 0) return byOrg;
      for (const record of await decisions.attentionCandidates(viewer, orgIds, start, end)) {
        const place = placeOf(record);
        const integrity = taskFileStatus(record);
        if (!place || !isCheckedTask(place.type) || !integrity) continue;
        if (integrity.state !== 'needs_attention' && integrity.state !== 'flagged_invalid') {
          continue;
        }
        const list = byOrg.get(record.organization.id) ?? [];
        list.push({
          documentId: record.id,
          title: record.title,
          projectId: place.project.id,
          projectName: place.project.name,
          task: place.type,
          label: place.label,
          integrity,
        });
        byOrg.set(record.organization.id, list);
      }
      return byOrg;
    },
  };
}

export type TaskFileDecisionService = ReturnType<typeof createTaskFileDecisionService>;
