import {
  formatPesos,
  semesterRange,
  type CorrectFinancialFiguresRequest,
  type FinancialFiguresInput,
  type FinancialFiguresListItem,
  type FinancialFiguresListResponse,
  type FinancialFiguresQuery,
  type ProjectFinancialFigures,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type {
  FiguresRecord,
  FinancialFiguresRepository,
} from '#src/repositories/financial-figures.repository';
import type { ProjectRecord, ProjectRepository } from '#src/repositories/project.repository';
import type { OrgRef } from '#src/services/access.service';
import type { RequestContext } from '#src/services/auth.service';
import type { Actor } from '#src/services/document.service';
import { figuresCorrectableUntil } from '#src/services/leaderboard-rules';
import type { NotificationService } from '#src/services/notification.service';
import type { Recipients } from '#src/services/recipients.service';

export interface FinancialFiguresServiceDeps {
  figures: Pick<FinancialFiguresRepository, 'save' | 'flag' | 'clearFlag' | 'listSubmitted'>;
  projects: Pick<ProjectRepository, 'findById'>;
  recipients: Pick<Recipients, 'officersOf'>;
  notifications: Pick<NotificationService, 'notify'>;
  audit: Pick<AuditLogRepository, 'record'>;
  now?: () => Date;
}

const reviewOf = (f: Pick<FiguresRecord, 'flaggedAt' | 'flagRemark'>) =>
  f.flaggedAt && f.flagRemark !== null
    ? { remark: f.flagRemark, flaggedAt: f.flaggedAt.toISOString() }
    : null;

/** One row of the ISSC's list. */
function listItem(
  f: FiguresRecord,
  project: {
    id: string;
    name: string;
    targetDate: Date;
    organization: { slug: string; acronym: string; name: string };
  },
): FinancialFiguresListItem {
  return {
    incomeCentavos: f.incomeCentavos,
    expensesCentavos: f.expensesCentavos,
    netCentavos: f.incomeCentavos - f.expensesCentavos,
    underReview: reviewOf(f),
    updatedAt: f.updatedAt.toISOString(),
    projectId: project.id,
    projectName: project.name,
    targetDate: project.targetDate.toISOString().slice(0, 10),
    organization: {
      slug: project.organization.slug,
      acronym: project.organization.acronym,
      name: project.organization.name,
    },
  };
}

/** The figures as their organization and its governing bodies see them. */
export function toFiguresView(
  record: Pick<ProjectRecord, 'targetDate' | 'postEventDueOverride'> & {
    figures: FiguresRecord | null;
  },
): ProjectFinancialFigures | null {
  const figures = record.figures;
  if (!figures) return null;
  const targetDate = record.targetDate.toISOString().slice(0, 10);
  return {
    incomeCentavos: figures.incomeCentavos,
    expensesCentavos: figures.expensesCentavos,
    netCentavos: figures.incomeCentavos - figures.expensesCentavos,
    underReview: reviewOf(figures),
    correctableUntil: figuresCorrectableUntil(
      targetDate,
      record.postEventDueOverride,
    ).toISOString(),
    updatedAt: figures.updatedAt.toISOString(),
  };
}

const amountsOf = (f: FiguresRecord | FinancialFiguresInput) => ({
  incomeCentavos: f.incomeCentavos,
  expensesCentavos: f.expensesCentavos,
});

/**
 * A Financial Report's totals (docs/PROJECT_WORKFLOW_SPEC.md, section 5D). The organization
 * enters them with every Financial Report file and can correct them until the semester
 * closes; the ISSC account can put them under review. Figures are never "approved", and the
 * flag never changes who can see the file. Every change is audited with before and after.
 */
export function createFinancialFiguresService({
  figures,
  projects,
  recipients,
  notifications,
  audit,
  now = () => new Date(),
}: FinancialFiguresServiceDeps) {
  async function loadProject(projectId: string): Promise<ProjectRecord> {
    const record = await projects.findById(projectId);
    if (!record) throw AppError.notFound('Project not found');
    return record;
  }

  async function tellOfficers(record: ProjectRecord, title: string, body: string, key: string) {
    const userIds = await recipients.officersOf(record.organizationId);
    if (userIds.length === 0) return;
    await notifications.notify({
      userIds,
      kind: 'figures_review',
      title,
      body,
      link: `/projects/${record.id}`,
      dedupeKey: key,
    });
  }

  /**
   * Stores the totals for a project of the acting organization, audited when they change.
   * Unchanged totals are a no-op; changed ones are refused once the semester closed.
   */
  async function save(
    actor: Actor,
    record: ProjectRecord,
    input: FinancialFiguresInput,
    actingAs: string,
  ): Promise<ProjectFinancialFigures> {
    const current = record.figures;
    const changes =
      !current ||
      current.incomeCentavos !== input.incomeCentavos ||
      current.expensesCentavos !== input.expensesCentavos;
    if (!changes) return toFiguresView(record)!;

    const until = figuresCorrectableUntil(
      record.targetDate.toISOString().slice(0, 10),
      record.postEventDueOverride,
    );
    if (current && now() > until) {
      throw AppError.conflict(
        'The semester of this project has closed, so its Financial Report figures can no longer be changed.',
      );
    }
    const { before, after } = await figures.save(record.id, amountsOf(input));
    await audit.record({
      action: 'financial_figures_change',
      actorId: actor.userId,
      entityType: 'project',
      entityId: record.id,
      organizationId: record.organizationId,
      metadata: { before: before && amountsOf(before), after: amountsOf(after) },
      ip: actor.ip,
      actingAs,
    });
    return toFiguresView({ ...record, figures: after })!;
  }

  return {
    /** With a Financial Report file (new or a new version): the project is already guarded. */
    saveWithFile(
      actor: Actor,
      record: ProjectRecord,
      input: FinancialFiguresInput,
      actingAs: string,
    ): Promise<ProjectFinancialFigures> {
      return save(actor, record, input, actingAs);
    },

    /** PATCH /projects/:projectId/financial-figures, by the project's own organization. */
    async correct(
      actor: Actor,
      org: OrgRef,
      projectId: string,
      input: CorrectFinancialFiguresRequest,
    ): Promise<ProjectFinancialFigures> {
      const record = await loadProject(projectId);
      if (record.organizationId !== org.id) throw AppError.notFound('Project not found');
      if (!record.figures) {
        throw AppError.conflict(
          'Upload the Financial Report with its totals first. You can correct them after that.',
        );
      }
      const { actingAs, ...amounts } = input;
      return save(actor, record, amounts, actingAs);
    },

    /** The ISSC account puts the figures under review (or rewords its remark). */
    async flag(
      actorId: string,
      projectId: string,
      remark: string,
      ctx: RequestContext,
    ): Promise<FinancialFiguresListItem> {
      const record = await loadProject(projectId);
      const at = now();
      const flagged = await figures.flag(projectId, { remark, flaggedById: actorId, at });
      if (!flagged) throw AppError.notFound('This project has no Financial Report figures yet');
      await audit.record({
        action: 'financial_figures_flag',
        actorId,
        entityType: 'project',
        entityId: projectId,
        organizationId: record.organizationId,
        metadata: { remark },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      const net = formatPesos(flagged.incomeCentavos - flagged.expensesCentavos);
      await tellOfficers(
        record,
        `Financial Report figures under review: ${record.name}`,
        `The ISSC is checking the figures of ${record.name} (net ${net}), so they are left out of your leaderboard total for now. The ISSC wrote: “${remark}” Check them and correct them if needed.`,
        `figures-flag:${projectId}:${at.toISOString()}`,
      );
      return listItem(flagged, record);
    },

    /** The ISSC account clears the review: the figures count again. Idempotent. */
    async clearFlag(
      actorId: string,
      projectId: string,
      ctx: RequestContext,
    ): Promise<FinancialFiguresListItem> {
      const record = await loadProject(projectId);
      if (!record.figures)
        throw AppError.notFound('This project has no Financial Report figures yet');
      const at = now();
      if (await figures.clearFlag(projectId)) {
        await audit.record({
          action: 'financial_figures_unflag',
          actorId,
          entityType: 'project',
          entityId: projectId,
          organizationId: record.organizationId,
          metadata: { remark: record.figures.flagRemark },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
        await tellOfficers(
          record,
          `Financial Report figures cleared: ${record.name}`,
          `The ISSC finished checking the figures of ${record.name}. They count toward your leaderboard total again.`,
          `figures-unflag:${projectId}:${at.toISOString()}`,
        );
      }
      return listItem({ ...record.figures, flaggedAt: null, flagRemark: null }, record);
    },

    /** GET /admin/financial-figures: the semester's submitted figures, for the ISSC. */
    async list(query: FinancialFiguresQuery): Promise<FinancialFiguresListResponse> {
      const rows = await figures.listSubmitted(semesterRange(query.academicYear, query.semester));
      return {
        items: rows.map((row) => listItem(row, { id: row.projectId, ...row.project })),
      };
    },
  };
}

export type FinancialFiguresService = ReturnType<typeof createFinancialFiguresService>;
