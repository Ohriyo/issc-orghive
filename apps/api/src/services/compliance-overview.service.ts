import {
  type ComplianceOverview,
  type ComplianceOverviewQuery,
  type ComplianceRow,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import type { ComplianceOverviewRepository } from '#src/repositories/compliance-overview.repository';
import type { AccountRepository } from '#src/repositories/account.repository';
import { complianceScopeOf } from '#src/services/account-rules';
import { USUAL_SEMESTER_READER, type SemesterReader } from '#src/services/semester-calendar.service';
import type { DocumentViewerService } from '#src/services/document-viewer.service';
import type { TaskFileDecisionService } from '#src/services/task-file-decision.service';
import { countByStatus, overdueTasks, planAll, upcomingDeadlines } from './project-figures';

export interface ComplianceOverviewServiceDeps {
  overview: ComplianceOverviewRepository;
  accounts: Pick<AccountRepository, 'findAccount'>;
  viewers: Pick<DocumentViewerService, 'forUser'>;
  /** Task files needing attention or flagged (spec section 6), with what the viewer may see. */
  attention: Pick<TaskFileDecisionService, 'attentionFiles'>;
  semesters?: SemesterReader;
  now?: () => Date;
}

type Scope = { type: 'ISSC'; acronym: string } | { type: 'CSC'; acronym: string; cscIds: string[] };

/**
 * The compliance overview: read-only figures from the F11 project data, for one semester.
 * Who sees what is complianceScopeOf (account-rules.ts): the ISSC account sees every CSC and
 * SBO; a CSC account sees its college's SBOs. Projects count when their target date is in the
 * semester; freezes and pending appeals belong to the organization, so they show whatever
 * the semester.
 */
export function createComplianceOverviewService({
  overview,
  accounts,
  viewers,
  attention,
  semesters = USUAL_SEMESTER_READER,
  now = () => new Date(),
}: ComplianceOverviewServiceDeps) {
  async function scopeOf(userId: string): Promise<Scope | null> {
    const account = await accounts.findAccount(userId);
    const scope = complianceScopeOf(account?.organization ?? null);
    if (!scope || !account) return null;
    const acronym = account.organization.acronym;
    return scope.type === 'ISSC'
      ? { type: 'ISSC', acronym }
      : { type: 'CSC', acronym, cscIds: [scope.cscId] };
  }

  return {
    /** Whether the user may open the overview (the dashboard links to it). */
    async canSee(userId: string): Promise<boolean> {
      return (await scopeOf(userId)) !== null;
    },

    /** 403 for users outside a CSC or the ISSC. Without a semester, the current one. */
    async get(userId: string, query: ComplianceOverviewQuery): Promise<ComplianceOverview> {
      const scope = await scopeOf(userId);
      if (!scope) throw AppError.forbidden('The compliance overview is for the CSCs and the ISSC');

      const at = now();
      const calendar = await semesters.load();
      const current = calendar.currentKey(at);
      const academicYear = query.academicYear ?? current.academicYear;
      const semester = query.semester ?? current.semester;
      const { start, end } = calendar.spanOf({ academicYear, semester });

      const collegeIds =
        scope.type === 'CSC' ? await overview.collegesOfCscs(scope.cscIds) : undefined;
      const orgs = await overview.organizations({ collegeIds });
      const ids = orgs.map((org) => org.id);
      const viewer = await viewers.forUser(userId);
      const [projects, freezes, appeals, files] = await Promise.all([
        overview.projectsInRange(ids, start, end),
        overview.openFreezes(ids),
        overview.pendingAppeals(ids),
        attention.attentionFiles(viewer, ids, start, end),
      ]);
      const planned = planAll(projects, at);

      const organizations: ComplianceRow[] = orgs.map((org) => {
        const mine = planned.filter((p) => p.record.organizationId === org.id);
        const counts = countByStatus(mine);
        return {
          organization: {
            type: org.type,
            slug: org.slug,
            acronym: org.acronym,
            name: org.name,
            college: org.college?.code ?? null,
          },
          activeProjects: counts.active,
          blockedProjects: mine
            .filter((p) => p.plan.status === 'blocked')
            .map((p) => ({ id: p.record.id, name: p.record.name })),
          nextDeadline: upcomingDeadlines(mine, at)[0] ?? null,
          overdueTasks: overdueTasks(mine, at),
          frozenSince: freezes.get(org.id)?.toISOString() ?? null,
          openAppeals: appeals.get(org.id) ?? 0,
          attentionFiles: files.get(org.id) ?? [],
        };
      });

      return {
        academicYear,
        semester,
        scope: { type: scope.type, acronym: scope.acronym },
        organizations,
      };
    },
  };
}

export type ComplianceOverviewService = ReturnType<typeof createComplianceOverviewService>;
