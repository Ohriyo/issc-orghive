import {
  academicYearOf,
  ErrorCode,
  isMultiFileTask,
  PRE_EVENT_CHOICES,
  PROJECT_TASK_DOCUMENT_TYPES,
  PROJECT_TASK_LABELS,
  type CreateFinancialReportDocumentRequest,
  type CreateProjectFileRequest,
  type CreateProjectRequest,
  type CreateTaskDocumentRequest,
  type ProjectDetail,
  type ProjectListResponse,
  type ProjectSummary,
  type ProjectTaskType,
  type UpdateProjectRequest,
  type UploadUrlRequest,
  type UploadUrlResponse,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { DocumentBrief, DocumentRepository } from '#src/repositories/document.repository';
import type { DocumentTypeRepository } from '#src/repositories/document-type.repository';
import type { DocumentViewer } from '#src/repositories/document-visibility';
import type { OrgFreezeRepository } from '#src/repositories/org-freeze.repository';
import type { ProjectRecord, ProjectRepository } from '#src/repositories/project.repository';
import type { OrgRef } from '#src/services/access.service';
import type { Actor, DocumentService } from '#src/services/document.service';
import type { DocumentViewerService } from '#src/services/document-viewer.service';
import {
  toFiguresView,
  type FinancialFiguresService,
} from '#src/services/financial-figures.service';
import { nextDeadline, planProject, type ProjectPlan } from '#src/services/project-rules';
import type { LeaderboardRecompute } from '#src/services/leaderboard-recompute';
import { factsOf, type ProjectSync } from '#src/services/project-sync.service';
import type { UploadService } from '#src/services/upload.service';

export interface ProjectServiceDeps {
  projects: Pick<
    ProjectRepository,
    | 'create'
    | 'findById'
    | 'listByOrganization'
    | 'update'
    | 'linkDocument'
    | 'addTaskFile'
    | 'addProjectFile'
  >;
  sync: Pick<ProjectSync, 'sync' | 'syncOrganization'>;
  freezes: Pick<OrgFreezeRepository, 'listOpen'>;
  documents: Pick<DocumentService, 'create' | 'addVersion'>;
  documentReads: Pick<DocumentRepository, 'findVisibleBriefs'>;
  documentTypes: Pick<DocumentTypeRepository, 'findBySlug'>;
  uploads: Pick<UploadService, 'issueUrl'>;
  viewers: Pick<DocumentViewerService, 'forUser'>;
  /** The Financial Report's totals (spec 5D), saved with its file. */
  figures: Pick<FinancialFiguresService, 'saveWithFile'>;
  audit: Pick<AuditLogRepository, 'record'>;
  /** A moved target date moves the project between semesters' standings (spec 5B). */
  leaderboard?: Pick<LeaderboardRecompute, 'forEventDates'>;
  now?: () => Date;
}

/** Why a task cannot take a file yet, in words for the officer. */
function lockedReason(type: ProjectTaskType, targetDate: string): string {
  if (type === 'ACR' || type === 'FINANCIAL_REPORT') {
    return `The ${PROJECT_TASK_LABELS[type]} opens on the event day, ${targetDate}.`;
  }
  return `The ${PROJECT_TASK_LABELS[type]} unlocks once the Project Proposal is submitted.`;
}

/** Whether a task already has a file (any state but deleted), so its tick must stay. */
function hasFile(task: ProjectRecord['tasks'][number] | undefined): boolean {
  if (!task) return false;
  const live = (doc: { deletedAt: Date | null } | null) => !!doc && !doc.deletedAt;
  return (!!task.documentId && live(task.document)) || task.files.some((f) => live(f.document));
}

/**
 * Projects and their milestone checklist (docs/PROJECT_WORKFLOW_SPEC.md, 2A and 2B). Org
 * guards authorize every call first. Task statuses always come from the unlock rules
 * (project-rules.ts); a task's file is a normal Paperworks document, uploaded through the
 * document pipeline, with the visibility the officer chose. Nothing is reviewed.
 */
export function createProjectService({
  projects,
  sync,
  freezes,
  documents,
  documentReads,
  documentTypes,
  uploads,
  viewers,
  figures,
  audit,
  leaderboard,
  now = () => new Date(),
}: ProjectServiceDeps) {
  function toSummary(record: ProjectRecord, plan: ProjectPlan): ProjectSummary {
    const next = nextDeadline(plan);
    return {
      id: record.id,
      name: record.name,
      targetDate: record.targetDate.toISOString().slice(0, 10),
      location: record.location,
      beneficiaries: record.beneficiaries,
      description: record.description,
      status: plan.status,
      proposalDueAt: plan.proposalDueAt.toISOString(),
      postEventDueAt: plan.postEventDueAt.toISOString(),
      nomRequired: record.nomRequired,
      momRequired: record.momRequired,
      communicationLetterRequired: record.communicationLetterRequired,
      attendanceSheetRequired: record.attendanceSheetRequired,
      nextDeadline: next && { type: next.type, dueAt: next.dueAt.toISOString() },
      organization: {
        type: record.organization.type,
        slug: record.organization.slug,
        acronym: record.organization.acronym,
        name: record.organization.name,
      },
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  /** Statuses from the rules as of now, so a read is right even between syncs. */
  async function toDetail(viewer: DocumentViewer, record: ProjectRecord): Promise<ProjectDetail> {
    const plan = planProject(factsOf(record), now());
    const rows = new Map(record.tasks.map((t) => [t.type, t]));
    const ids = [
      ...record.tasks.flatMap((t) => [
        ...(t.documentId ? [t.documentId] : []),
        ...t.files.map((f) => f.documentId),
      ]),
      ...record.extraFiles.map((f) => f.documentId),
    ];
    const briefs: Map<string, DocumentBrief> = await documentReads.findVisibleBriefs(viewer, ids);
    return {
      ...toSummary(record, plan),
      tasks: plan.tasks.map((task) => {
        const row = rows.get(task.type);
        const brief = row?.documentId ? briefs.get(row.documentId) : undefined;
        return {
          type: task.type,
          status: task.status,
          required: task.required,
          dueAt: task.dueAt?.toISOString() ?? null,
          submittedAt:
            task.status === 'submitted' ? (row?.submittedAt ?? now()).toISOString() : null,
          document: brief ?? null,
          // Only the files this viewer may see: the visibility rule applies to each.
          files: (row?.files ?? []).flatMap((f) => {
            const file = briefs.get(f.documentId);
            return file ? [{ label: f.label, document: file }] : [];
          }),
        };
      }),
      // Extra files outside the checklist, only those this viewer may see.
      files: record.extraFiles.flatMap((f) => {
        const document = briefs.get(f.documentId);
        return document ? [{ document }] : [];
      }),
      financialFigures: toFiguresView(record),
    };
  }

  /** A project of the guarded organization, or 404. */
  async function loadInOrg(org: OrgRef, id: string): Promise<ProjectRecord> {
    const record = await projects.findById(id);
    if (!record || record.organizationId !== org.id) throw AppError.notFound('Project not found');
    return record;
  }

  async function synced(id: string): Promise<ProjectRecord> {
    const record = await sync.sync(id);
    if (!record) throw AppError.notFound('Project not found');
    return record;
  }

  /** A new task document of the project, through the document pipeline (scanning first). */
  async function createTaskDocument(
    actor: Actor,
    org: OrgRef,
    record: ProjectRecord,
    type: ProjectTaskType,
    input: CreateTaskDocumentRequest,
    title: string,
  ) {
    const { slug } = PROJECT_TASK_DOCUMENT_TYPES[type];
    const docType = await documentTypes.findBySlug(slug);
    if (!docType) throw new Error(`Document type ${slug} is missing; run the migrations`);
    return documents.create(actor, org, {
      typeId: docType.id,
      title: title.slice(0, 200),
      academicYear: academicYearOf(factsOf(record).targetDate),
      visibility: input.visibility,
      tags: [],
      uploadKey: input.uploadKey,
      actingAs: input.actingAs,
    });
  }

  /**
   * A multi-file task: a new labelled file (a letter to another office), or with
   * `documentId` a new version of one of its files. 404 for a file of another task.
   */
  async function fileMultiTask(
    actor: Actor,
    org: OrgRef,
    record: ProjectRecord,
    type: ProjectTaskType,
    row: ProjectRecord['tasks'][number] | undefined,
    input: CreateTaskDocumentRequest,
  ): Promise<void> {
    if (input.documentId) {
      const file = row?.files.find((f) => f.documentId === input.documentId);
      if (!file || !file.document || file.document.deletedAt) {
        throw AppError.notFound('File not found in this task');
      }
      const inProgress = file.document.status === 'scanning' || file.document.status === 'quarantined';
      if (inProgress && file.document.createdById !== actor.userId) {
        throw AppError.conflict(
          'Another officer’s copy of this file is still being checked. Try again once it is done.',
        );
      }
      await documents.addVersion(actor, org, file.documentId, {
        uploadKey: input.uploadKey,
        actingAs: input.actingAs,
      });
      return;
    }
    const label = input.label!;
    const created = await createTaskDocument(
      actor,
      org,
      record,
      type,
      input,
      `${PROJECT_TASK_LABELS[type]}: ${label} (${record.name})`,
    );
    await projects.addTaskFile(record.id, type, created.id, label);
  }

  /** The task as the rules see it now; 404 if the project does not need it, 409 if locked. */
  function openTask(record: ProjectRecord, type: ProjectTaskType) {
    const plan = planProject(factsOf(record), now());
    if (plan.status === 'blocked') {
      throw AppError.conflict(
        'This project is blocked. Its tasks unlock once an appeal is approved.',
      );
    }
    const task = plan.tasks.find((t) => t.type === type);
    if (!task) throw AppError.notFound(`This project does not need a ${PROJECT_TASK_LABELS[type]}`);
    if (task.status === 'locked') {
      throw AppError.conflict(lockedReason(type, factsOf(record).targetDate));
    }
    return task;
  }

  return {
    /** The organization's projects, soonest event first, with each one's next deadline. */
    async list(org: OrgRef): Promise<ProjectListResponse> {
      // The check on read: deadlines that passed since the last hourly run take effect now.
      await sync.syncOrganization(org.id);
      const at = now();
      const records = await projects.listByOrganization(org.id);
      return {
        items: records.map((record) => toSummary(record, planProject(factsOf(record), at))),
      };
    },

    async get(actor: Actor, org: OrgRef, id: string): Promise<ProjectDetail> {
      await loadInOrg(org, id);
      const record = await synced(id);
      return toDetail(await viewers.forUser(actor.userId), record);
    },

    /**
     * Creates the project with its checklist (spec 2B), audited. A frozen organization
     * cannot (spec 3B): 403 until an appeal lifts every freeze.
     */
    async create(actor: Actor, org: OrgRef, input: CreateProjectRequest): Promise<ProjectDetail> {
      await sync.syncOrganization(org.id);
      const open = await freezes.listOpen(org.id);
      if (open.length > 0) {
        const names = open.map((f) => f.project.name).join(', ');
        throw new AppError(
          403,
          ErrorCode.ORGANIZATION_FROZEN,
          `Your organization is frozen because the Activity Completion Report or Financial Report for ${names} is overdue. You can create projects again once an appeal is approved.`,
        );
      }
      const createdAt = now();
      const fields = {
        organizationId: org.id,
        name: input.name,
        targetDate: input.targetDate,
        location: input.location,
        beneficiaries: input.beneficiaries,
        description: input.description,
        nomRequired: input.nomRequired ?? false,
        momRequired: input.momRequired ?? false,
        communicationLetterRequired: input.communicationLetterRequired ?? false,
        attendanceSheetRequired: input.attendanceSheetRequired ?? false,
        createdById: actor.userId,
        createdAt,
      };
      // The creating account is the organization's own (requireOwnOrg), so its type is the org's.
      const viewer = await viewers.forUser(actor.userId);
      const plan = planProject(
        {
          ...fields,
          proposalDueOverride: null,
          postEventDueOverride: null,
          filed: new Set(),
          exemptFromCompliance: viewer.kind === 'account' && viewer.organizationType === 'ISSC',
        },
        createdAt,
      );
      const created = await projects.create(fields, plan);
      await audit.record({
        action: 'project_create',
        actorId: actor.userId,
        entityType: 'project',
        entityId: created.id,
        organizationId: org.id,
        metadata: { targetDate: input.targetDate },
        ip: actor.ip,
      });
      return toDetail(viewer, created);
    },

    /**
     * Details, the target date (the deadlines follow) and which optional pre-event documents
     * the project needs (spec 2B). A ticked document that already has a file stays ticked:
     * 409. Audited.
     */
    async update(
      actor: Actor,
      org: OrgRef,
      id: string,
      patch: UpdateProjectRequest,
    ): Promise<ProjectDetail> {
      const record = await loadInOrg(org, id);
      for (const [type, field] of Object.entries(PRE_EVENT_CHOICES) as [
        keyof typeof PRE_EVENT_CHOICES,
        (typeof PRE_EVENT_CHOICES)[keyof typeof PRE_EVENT_CHOICES],
      ][]) {
        const task = record.tasks.find((t) => t.type === type);
        if (patch[field] === false && hasFile(task)) {
          throw AppError.conflict(
            `The ${PROJECT_TASK_LABELS[type]} already has a file, so it stays part of this project.`,
          );
        }
      }
      await projects.update(id, patch);
      const updated = await synced(id);
      await audit.record({
        action: 'project_update',
        actorId: actor.userId,
        entityType: 'project',
        entityId: id,
        organizationId: org.id,
        metadata: { fields: Object.keys(patch) },
        ip: actor.ip,
      });
      if (patch.targetDate !== undefined) {
        await leaderboard?.forEventDates(record.targetDate, updated.targetDate);
      }
      return toDetail(await viewers.forUser(actor.userId), updated);
    },

    /** A pre-signed PUT for an extra file of the project (spec 2C). */
    async fileUploadUrl(
      actor: Actor,
      org: OrgRef,
      id: string,
      file: UploadUrlRequest,
    ): Promise<UploadUrlResponse> {
      await loadInOrg(org, id);
      return uploads.issueUrl(actor.userId, org, file);
    },

    /**
     * An extra file outside the checklist (spec 2C): a normal Paperworks document with the
     * details the officer gave, through the document pipeline (scanning first, audited, the
     * caches cleared), then linked to the project. No deadline and no unlock rule, so it is
     * allowed whatever the checklist's state, a blocked project or a frozen organization too.
     */
    async addFile(
      actor: Actor,
      org: OrgRef,
      id: string,
      input: CreateProjectFileRequest,
    ): Promise<ProjectDetail> {
      await loadInOrg(org, id);
      const created = await documents.create(actor, org, input);
      await projects.addProjectFile(id, created.id);
      return toDetail(await viewers.forUser(actor.userId), await synced(id));
    },

    /** A pre-signed PUT for a task's file: the task must be open (or submitted, to replace it). */
    async taskUploadUrl(
      actor: Actor,
      org: OrgRef,
      id: string,
      type: ProjectTaskType,
      file: UploadUrlRequest,
    ): Promise<UploadUrlResponse> {
      openTask(await loadInOrg(org, id), type);
      return uploads.issueUrl(actor.userId, org, file);
    },

    /**
     * Files an uploaded object as the task's document, through the document pipeline: the
     * first upload creates the document (scanning, visible to the uploader only), later ones
     * add versions. A multi-file task takes a new labelled file each time, or a new version
     * of one of its files (`documentId`). The task becomes submitted when the worker finds the file clean. A
     * Financial Report's totals are saved first, so a refused change files nothing.
     */
    async submitTaskFile(
      actor: Actor,
      org: OrgRef,
      id: string,
      type: ProjectTaskType,
      input: CreateTaskDocumentRequest | CreateFinancialReportDocumentRequest,
    ): Promise<ProjectDetail> {
      const record = await loadInOrg(org, id);
      openTask(record, type);
      if (type === 'FINANCIAL_REPORT') {
        if (!('figures' in input)) {
          throw new AppError(
            400,
            ErrorCode.VALIDATION_ERROR,
            'Enter the Financial Report’s total income and total expenses',
          );
        }
        await figures.saveWithFile(actor, record, input.figures, input.actingAs);
      }
      const row = record.tasks.find((t) => t.type === type);
      if (isMultiFileTask(type)) {
        await fileMultiTask(actor, org, record, type, row, input);
        const updated = await synced(id);
        return toDetail(await viewers.forUser(actor.userId), updated);
      }
      const current = row?.documentId && row.document && !row.document.deletedAt ? row : null;

      if (current) {
        const inProgress =
          current.document!.status === 'scanning' || current.document!.status === 'quarantined';
        if (inProgress && current.document!.createdById !== actor.userId) {
          throw AppError.conflict(
            'Another officer’s file for this task is still being checked. Try again once it is done.',
          );
        }
        await documents.addVersion(actor, org, current.documentId!, {
          uploadKey: input.uploadKey,
          actingAs: input.actingAs,
        });
      } else {
        const created = await createTaskDocument(
          actor,
          org,
          record,
          type,
          input,
          `${PROJECT_TASK_LABELS[type]}: ${record.name}`,
        );
        await projects.linkDocument(id, type, created.id);
      }
      // The scan may already have finished; the sync settles either way.
      const updated = await synced(id);
      return toDetail(await viewers.forUser(actor.userId), updated);
    },
  };
}

export type ProjectService = ReturnType<typeof createProjectService>;
