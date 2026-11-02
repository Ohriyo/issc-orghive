import {
  isCheckedTask,
  type DashboardOrganization,
  type DashboardResponse,
  type DocumentCounts,
  type SemesterCalendar,
  type SemesterSummary,
} from '@orghive/shared';
import type { PublicUrl } from '#src/lib/public-url';
import { USUAL_SEMESTER_READER, type SemesterReader } from '#src/services/semester-calendar.service';
import type { Storage } from '#src/lib/storage';
import type { DashboardRepository } from '#src/repositories/dashboard.repository';
import type { DocumentRepository } from '#src/repositories/document.repository';
import type { AccountRepository } from '#src/repositories/account.repository';
import type { ProjectRecord, ProjectRepository } from '#src/repositories/project.repository';
import { toOrganizationSummary } from '#src/services/college.service';
import { presentSummary, toStoredSummary } from '#src/services/document.service';
import { complianceScopeOf, isCouncil, isIssc } from '#src/services/account-rules';
import type { DocumentViewerService } from '#src/services/document-viewer.service';
import { taskFileStatus } from '#src/services/integrity-rules';
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
  semesters?: SemesterReader;
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

/** The organization's task files still legacy, unverified (spec section 6E). */
function legacyFilesOf(records: ProjectRecord[]): DashboardOrganization['legacyTaskFiles'] {
  return records.flatMap((record) =>
    record.tasks.flatMap((task) => {
      if (!isCheckedTask(task.type)) return [];
      const files = [
        ...(task.document ? [{ label: null, document: task.document }] : []),
        ...task.files.map((f) => ({ label: f.label, document: f.document })),
      ];
      return files
        .filter((f) => taskFileStatus(f.document)?.state === 'legacy')
        .map((f) => ({
          projectId: record.id,
          projectName: record.name,
          task: task.type,
          label: f.label,
        }));
    }),
  );
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
  semesters = USUAL_SEMESTER_READER,
  now = () => new Date(),
}: DashboardServiceDeps) {
  /**
   * "This semester" for the account's organization: its projects whose
   * target date is in the current semester, by status, and the next three deadlines of any
   * of its projects (a December event's reports fall due in January).
   */
  function semesterSummary(
    records: ProjectRecord[],
    at: Date,
    calendar: SemesterCalendar,
  ): SemesterSummary {
    const { academicYear, semester } = calendar.currentKey(at);
    const { start, end } = calendar.spanOf({ academicYear, semester });
    const planned = planAll(records, at);
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
      const [counts, recent, quarantined, activity, records] = await Promise.all([
        dashboard.countForDashboard(viewer, [org.id]),
        documents.list(viewer, { organizationId: org.id, limit: DASHBOARD_RECENT_DOCUMENTS }),
        dashboard.listQuarantined(viewer, org.id, DASHBOARD_QUARANTINED),
        dashboard.listActivity(viewer, org.id, DASHBOARD_ACTIVITY),
        projects.listByOrganization(org.id),
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
        semester: semesterSummary(records, at, await semesters.load()),
        legacyTaskFiles: legacyFilesOf(records),
      };

      return { term: termOut, organizations: [organization], ...flags };
    },
  };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
