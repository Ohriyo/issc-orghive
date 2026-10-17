import {
  APPEAL_TYPE_LABELS,
  PROJECT_TASK_LABELS,
  type Appeal,
  type AppealStatus,
  type AttachmentScanStatus,
  type OrganizationCompliance,
  type ProjectTaskType,
} from '@orghive/shared';
import { formatManilaDate } from '@/features/projects/presenters/project-format';

export const APPEAL_STATUS_LABEL: Record<AppealStatus, string> = {
  pending: 'Waiting for a decision',
  approved: 'Approved',
  rejected: 'Rejected',
};

/** "Activity Completion Report and Financial Report". */
export function reportList(types: ProjectTaskType[]): string {
  return types.map((t) => PROJECT_TASK_LABELS[t]).join(' and ');
}

/** The appeal form for a blocked project or a freeze. */
export function newAppealHref(
  slug: string,
  target: { projectId: string } | { freezeId: string },
): string {
  const query = new URLSearchParams({ org: slug });
  if ('projectId' in target) query.set('project', target.projectId);
  else query.set('freeze', target.freezeId);
  return `/dashboard/appeals/new?${query.toString()}`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface AppealAttachmentItem {
  id: string;
  filename: string;
  size: string;
  /** Only clean files can be opened. */
  canOpen: boolean;
  scanStatus: AttachmentScanStatus;
}

/** One appeal, shaped for the history and the decision queue. */
export interface AppealItem {
  id: string;
  /** "Blocked project", "Organization freeze". */
  typeLabel: string;
  status: AppealStatus;
  statusLabel: string;
  org: { acronym: string; name: string };
  deciderAcronym: string;
  project: { name: string; href: string; eventDate: string };
  /** ORG_FREEZE: "Activity Completion Report and Financial Report overdue". */
  detail: string;
  reason: string;
  remarks: string | null;
  /** "Submitted Oct 16, 2026 by Juan". */
  submitted: string;
  /** "Rejected Oct 17, 2026 by Maria"; null while pending. */
  decided: string | null;
  /** "New due date: Oct 25, 2026" on an approval. */
  newDue: string | null;
  attachments: AppealAttachmentItem[];
  canDecide: boolean;
}

export function toAppealItem(appeal: Appeal): AppealItem {
  return {
    id: appeal.id,
    typeLabel: APPEAL_TYPE_LABELS[appeal.type],
    status: appeal.status,
    statusLabel: APPEAL_STATUS_LABEL[appeal.status],
    org: { acronym: appeal.organization.acronym, name: appeal.organization.name },
    deciderAcronym: appeal.decider.acronym,
    project: {
      name: appeal.project.name,
      href: `/projects/${appeal.project.id}`,
      eventDate: formatManilaDate(appeal.project.targetDate),
    },
    detail: appeal.freeze
      ? `${reportList(appeal.freeze.reports)} overdue`
      : 'Project Proposal not submitted by its deadline',
    reason: appeal.reason,
    remarks: appeal.remarks,
    submitted: `Submitted ${formatManilaDate(appeal.submittedAt)} by ${appeal.submittedBy.name}`,
    decided:
      appeal.decidedAt && appeal.status !== 'pending'
        ? `${APPEAL_STATUS_LABEL[appeal.status]} ${formatManilaDate(appeal.decidedAt)}${appeal.decidedBy ? ` by ${appeal.decidedBy.name}` : ''}`
        : null,
    newDue: appeal.newDueAt ? `New due date: ${formatManilaDate(appeal.newDueAt)}` : null,
    attachments: appeal.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      size: fileSize(a.sizeBytes),
      canOpen: a.scanStatus === 'clean',
      scanStatus: a.scanStatus,
    })),
    canDecide: appeal.canDecide,
  };
}

/** A block or a freeze, as the banners show it. */
export interface ComplianceNotice {
  kind: 'blocked' | 'frozen';
  /** The block's project id or the freeze id. */
  id: string;
  projectId: string;
  projectName: string;
  projectHref: string;
  /** What went wrong, in a sentence. */
  message: string;
  /** "Appeal submitted Oct 16, 2026. CSC-CEA will decide it." */
  pending: string | null;
  rejection: { remarks: string; date: string } | null;
  /** The appeal form, for the organization's officers while nothing is pending. */
  appealHref: string | null;
}

export interface ComplianceSummary {
  frozen: boolean;
  deciderAcronym: string;
  notices: ComplianceNotice[];
}

/** Pure: the compliance response as banners, freezes first. */
export function toComplianceSummary(
  data: OrganizationCompliance,
  slug: string,
  canAppeal: boolean,
): ComplianceSummary {
  const decider = data.decider.acronym;
  const pendingLine = (p: { submittedAt: string } | null) =>
    p ? `Appeal submitted ${formatManilaDate(p.submittedAt)}. ${decider} will decide it.` : null;
  const rejection = (r: { remarks: string; decidedAt: string } | null) =>
    r && { remarks: r.remarks, date: formatManilaDate(r.decidedAt) };

  return {
    frozen: data.frozen,
    deciderAcronym: decider,
    notices: [
      ...data.freezes.map((f): ComplianceNotice => ({
        kind: 'frozen',
        id: f.id,
        projectId: f.project.id,
        projectName: f.project.name,
        projectHref: `/projects/${f.project.id}`,
        message: `The ${reportList(f.reports)} for ${f.project.name} ${f.reports.length > 1 ? 'were' : 'was'} not submitted on time. New projects cannot be created until an appeal is approved.`,
        pending: pendingLine(f.pendingAppeal),
        rejection: rejection(f.lastRejection),
        appealHref: canAppeal && !f.pendingAppeal ? newAppealHref(slug, { freezeId: f.id }) : null,
      })),
      ...data.blockedProjects.map((p): ComplianceNotice => ({
        kind: 'blocked',
        id: p.id,
        projectId: p.id,
        projectName: p.name,
        projectHref: `/projects/${p.id}`,
        message: `The Project Proposal for ${p.name} was due ${formatManilaDate(p.proposalDueAt)} and was not submitted, so its tasks are locked.`,
        pending: pendingLine(p.pendingAppeal),
        rejection: rejection(p.lastRejection),
        appealHref: canAppeal && !p.pendingAppeal ? newAppealHref(slug, { projectId: p.id }) : null,
      })),
    ],
  };
}
