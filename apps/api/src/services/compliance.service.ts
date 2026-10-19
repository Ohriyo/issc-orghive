import { PROJECT_TASK_LABELS, type ProjectStatus, type ProjectTaskType } from '@orghive/shared';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { OrgFreezeRepository } from '#src/repositories/org-freeze.repository';
import type { ProjectRecord } from '#src/repositories/project.repository';
import type { NotificationService } from './notification.service';
import { deadlinesSoon, type ProjectPlan } from './project-rules';
import type { Recipients } from './recipients.service';

export interface ComplianceDeps {
  freezes: Pick<OrgFreezeRepository, 'openIfAbsent'>;
  recipients: Pick<Recipients, 'officersOf'>;
  notifications: Pick<NotificationService, 'notify'>;
  audit: Pick<AuditLogRepository, 'record'>;
}

const manilaDay = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeZone: 'Asia/Manila',
});
const day = (at: Date) => manilaDay.format(at);
const reportList = (types: ProjectTaskType[]) =>
  types.map((t) => PROJECT_TASK_LABELS[t]).join(' and ');

/**
 * What happens when the rules (project-rules.ts) say a project crossed a deadline
 * (docs/PROJECT_WORKFLOW_SPEC.md, section 3). Called by ProjectSync on every check: the
 * hourly job, reads, and changes. Every step is idempotent: a block is acted on only by the
 * check that changed the status, a freeze only by the check that opened it, and reminders
 * carry a dedupe key, so running the checks twice notifies and audits nothing twice.
 */
export function createCompliance({ freezes, recipients, notifications, audit }: ComplianceDeps) {
  async function tellOfficers(
    record: ProjectRecord,
    input: Omit<Parameters<NotificationService['notify']>[0], 'userIds'>,
  ) {
    const userIds = await recipients.officersOf(record.organizationId);
    if (userIds.length > 0) await notifications.notify({ ...input, userIds });
  }

  return {
    /** This check changed the project's stored status from `from` to `plan.status`. */
    async statusChanged(record: ProjectRecord, from: ProjectStatus, plan: ProjectPlan) {
      if (plan.status === 'blocked') {
        await audit.record({
          action: 'project_block',
          entityType: 'project',
          entityId: record.id,
          organizationId: record.organizationId,
          metadata: { proposalDueAt: plan.proposalDueAt.toISOString() },
        });
        await tellOfficers(record, {
          kind: 'deadline_missed',
          title: `${record.name} is blocked`,
          body: `The Project Proposal for ${record.name} was due ${day(plan.proposalDueAt)} and was not submitted, so the project is blocked and its tasks are locked. Submit an appeal to unblock it.`,
          link: `/projects/${record.id}`,
          dedupeKey: `project-blocked:${record.id}:${plan.proposalDueAt.toISOString()}`,
        });
      } else if (from === 'blocked') {
        await audit.record({
          action: 'project_unblock',
          entityType: 'project',
          entityId: record.id,
          organizationId: record.organizationId,
          metadata: { proposalDueAt: plan.proposalDueAt.toISOString() },
        });
      }
    },

    /** After every check: freeze for overdue reports, and remind of deadlines in 3 days. */
    async planApplied(record: ProjectRecord, plan: ProjectPlan, at: Date) {
      if (plan.overdueReports.length > 0) {
        const freeze = await freezes.openIfAbsent({
          organizationId: record.organizationId,
          projectId: record.id,
          reports: plan.overdueReports,
          frozenAt: at,
        });
        if (freeze) {
          await audit.record({
            action: 'org_freeze',
            entityType: 'org_freeze',
            entityId: freeze.id,
            organizationId: record.organizationId,
            metadata: {
              projectId: record.id,
              reports: plan.overdueReports,
              postEventDueAt: plan.postEventDueAt.toISOString(),
            },
          });
          await tellOfficers(record, {
            kind: 'deadline_missed',
            title: `${record.organization.acronym} is frozen`,
            body: `The ${reportList(plan.overdueReports)} for ${record.name} ${plan.overdueReports.length > 1 ? 'were' : 'was'} due ${day(plan.postEventDueAt)} and ${plan.overdueReports.length > 1 ? 'were' : 'was'} not submitted. ${record.organization.acronym} cannot create new projects until an appeal is approved.`,
            link: '/dashboard',
            dedupeKey: `org-frozen:${freeze.id}`,
          });
        }
      }

      for (const soon of deadlinesSoon(plan, at)) {
        await tellOfficers(record, {
          kind: 'deadline_soon',
          title: `${PROJECT_TASK_LABELS[soon.type]} due ${day(soon.dueAt)}`,
          body: `The ${PROJECT_TASK_LABELS[soon.type]} for ${record.name} is due ${day(soon.dueAt)} at 11:59 PM.`,
          link: `/projects/${record.id}`,
          dedupeKey: `deadline-soon:${record.id}:${soon.type}:${soon.dueAt.toISOString()}`,
        });
      }
    },
  };
}

export type Compliance = ReturnType<typeof createCompliance>;
