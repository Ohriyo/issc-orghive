import {
  academicYearOf,
  manilaDate,
  semesterOf,
  semesterRange,
  type DashboardOrganization,
  type DashboardResponse,
  type DocumentCounts,
  type SemesterSummary,
} from '@orghive/shared';
import type { PublicUrl } from '#src/lib/public-url';
import type { Storage } from '#src/lib/storage';
import type { DashboardRepository } from '#src/repositories/dashboard.repository';
import type { DocumentRepository } from '#src/repositories/document.repository';
import type { AccountRepository } from '#src/repositories/account.repository';
import type { ProjectRepository } from '#src/repositories/project.repository';
import { toOrganizationSummary } from '#src/services/college.service';
import { presentSummary, toStoredSummary } from '#src/services/document.service';
import { complianceScopeOf, isCouncil, isIssc } from '#src/services/account-rules';
import type { DocumentViewerService } from '#src/services/document-viewer.service';
import { countByStatus, planAll, upcomingDeadlines } from '#src/services/project-figures';

/** How many documents and activity entries each organization shows. */
export const DASHBOARD_RECENT_DOCUMENTS = 5;
export const DASHBOARD_QUARANTINED = 10;
export const DASHBOARD_ACTIVITY = 10;
/** "This semester" lists the next this many deadlines. */
export const SEMESTER_DEADLINES = 3;

export interface DashboardServiceDeps {
  accounts: Pick<AccountRepository, 'findAccount' | 'findCurrentTerm'>;
  dashboard: Pick<DashboardRepository, 'countForDashboard' | 'listQuarantined' | 'listActivity'>;
  documents: Pick<DocumentRepository, 'list'>;
  viewers: Pick<DocumentViewerService, 'forUser'>;
  projects: Pick<ProjectRepository, 'listByOrganization'>;
  storage: Pick<Storage, 'presignGet'>;
  publicUrl: PublicUrl;
  now?: () => Date;
}

const NO_DOCUMENTS: DocumentCounts = {
  public: 0,
  governing: 0,
  private: 0,
  scanning: 0,
  quarantined: 0,
  archived: 0,
};

/** `YYYY-MM-DD` of a DATE column (stored as UTC midnight). */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The signed-in workspace: the shared account's own organization only, so an account never
 * sees another organization's numbers; every document read still goes through the
 * repository's visibility filter.
 */
export function createDashboardService({
  accounts,
  dashboard,
  documents,
  viewers,
  projects,
  storage,
  publicUrl,
  now = () => new Date(),
}: DashboardServiceDeps) {
  /**
   * "This semester" for the account's organization: its projects whose
   * target date is in the current semester, by status, and the next three deadlines of any
   * of its projects (a December event's reports fall due in January).
   */
  async function semesterSummary(organizationId: string, at: Date): Promise<SemesterSummary> {
    const today = manilaDate(at);
    const academicYear = academicYearOf(today);
    const semester = semesterOf(today);
    const { start, end } = semesterRange(academicYear, semester);
    const planned = planAll(await projects.listByOrganization(organizationId), at);
    const inSemester = planned.filter((p) => {
      const day = isoDay(p.record.targetDate);
      return day >= start && day <= end;
    });
    return {
      academicYear,
      semester,
      counts: countByStatus(inSemester),
      nextDeadlines: upcomingDeadlines(planned, at).slice(0, SEMESTER_DEADLINES),
    };
  }

  return {
    async forUser(userId: string): Promise<DashboardResponse> {
      const [account, term, viewer] = await Promise.all([
        accounts.findAccount(userId),
        accounts.findCurrentTerm(userId),
        viewers.forUser(userId),
      ]);
      const org = account?.organization ?? null;
      const flags = {
        isIssc: isIssc(org),
        canSeeCompliance: complianceScopeOf(org) !== null,
        decidesAppeals: isCouncil(org),
      };
      const termOut = term && {
        officerInCharge: {
          name: term.officerName,
          position: term.officerPosition,
          email: term.officerEmail,
        },
        termEnd: term.termEnd ? isoDay(term.termEnd) : null,
      };
      if (!org || viewer.kind !== 'account') {
        return { term: termOut, organizations: [], ...flags };
      }

      const at = now();
      const [counts, recent, quarantined, activity, semester] = await Promise.all([
        dashboard.countForDashboard(viewer, [org.id]),
        documents.list(viewer, { organizationId: org.id, limit: DASHBOARD_RECENT_DOCUMENTS }),
        dashboard.listQuarantined(viewer, org.id, DASHBOARD_QUARANTINED),
        dashboard.listActivity(viewer, org.id, DASHBOARD_ACTIVITY),
        semesterSummary(org.id, at),
      ]);
      const organization: DashboardOrganization = {
        organization: { id: org.id, ...toOrganizationSummary(org, publicUrl) },
        counts: { ...NO_DOCUMENTS, ...counts.get(org.id) },
        recentDocuments: await Promise.all(
          recent.items.map((doc) => presentSummary(storage, toStoredSummary(doc))),
        ),
        quarantined: await Promise.all(
          quarantined.map((doc) => presentSummary(storage, toStoredSummary(doc))),
        ),
        activity: activity.map((entry) => ({
          id: entry.id,
          kind: entry.action,
          at: entry.createdAt.toISOString(),
          actorName: entry.actorName,
          actingAs: entry.actingAs,
          document: entry.document,
          version: entry.version,
        })),
        semester,
      };

      return { term: termOut, organizations: [organization], ...flags };
    },
  };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
