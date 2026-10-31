import {
  addDays,
  APPEAL_TYPE_LABELS,
  currentSemesterKey,
  deadlineAfter,
  endOfManilaDay,
  manilaDate,
  PROJECT_TASK_LABELS,
  semesterRange,
  type AppealStatus,
  type AppealType,
  type NotificationKind,
  type ProjectTaskType,
} from '@orghive/shared';
import type { StandingOrgRecord } from '#src/repositories/leaderboard.repository';
import { deadlinesAfterApproval, planProject, type ProjectPlan } from './project-rules';

/*
 * Demo data (pnpm --filter api db:seed:demo): sample activity on existing organizations so
 * empty features can be shown during development and demos, removed before deployment.
 * Everything here is pure: what the demo data is, placed relative to the current semester
 * so it always looks current. demo-data.service.ts writes it; nothing here decides a rule
 * of its own. Ranks, blocks, freezes and appeal routing all come from the real rules
 * (leaderboard-rules.ts, project-rules.ts, appeal-rules.ts) applied to this data.
 */

/**
 * The SBOs the demo data uses, created as demo organizations (under their college's CSC)
 * only when the normal seed has not made them. The councils must exist: run db:seed first.
 */
export const DEMO_SBOS: { slug: string; acronym: string; name: string; parent: string }[] = [
  {
    slug: 'asit',
    acronym: 'ASIT',
    name: 'Allied Students of Information Technology',
    parent: 'csc-ccis',
  },
  { slug: 'tag', acronym: 'TAG', name: 'The Animation Guild', parent: 'csc-ccis' },
  { slug: 'iso', acronym: 'ISO', name: 'Information Systems Organization', parent: 'csc-ccis' },
  {
    slug: 'jpice',
    acronym: 'JPICE',
    name: 'Junior Philippine Institute of Civil Engineers',
    parent: 'csc-cea',
  },
  {
    slug: 'iecep',
    acronym: 'IECEP',
    name: 'Institute of Electronics Engineers of the Philippines',
    parent: 'csc-cea',
  },
  {
    slug: 'uapsa',
    acronym: 'UAPSA',
    name: 'United Architects of the Philippines Student Auxiliary',
    parent: 'csc-cea',
  },
  {
    slug: 'psme',
    acronym: 'PSME',
    name: 'Philippine Society of Mechanical Engineers',
    parent: 'csc-cea',
  },
  {
    slug: 'jiiee',
    acronym: 'JIIEE',
    name: 'Junior Institute of Integrated Electrical Engineers',
    parent: 'csc-cea',
  },
];

/** One demo project of an existing organization (by slug). */
export interface DemoProject {
  /** Stable within the plan; other demo rows refer to the project by it. */
  key: string;
  org: string;
  name: string;
  location: string;
  beneficiaries: string;
  description: string;
  createdAt: Date;
  /** The event date in Manila, `YYYY-MM-DD`. */
  targetDate: string;
  nomRequired: boolean;
  communicationLetterRequired: boolean;
  /** Tasks whose file passed the scan, and when. Each gets a demo PDF. */
  submitted: Partial<Record<ProjectTaskType, Date>>;
  /** The Financial Report's totals, in centavos. */
  figures: { incomeCentavos: number; expensesCentavos: number } | null;
}

export interface DemoFreeze {
  key: string;
  project: string;
  reports: ProjectTaskType[];
  frozenAt: Date;
  liftedAt: Date | null;
}

export interface DemoAppeal {
  key: string;
  type: AppealType;
  project: string;
  /** ORG_FREEZE only. */
  freeze: string | null;
  reason: string;
  status: AppealStatus;
  remarks: string | null;
  /** The day an approval set (23:59:59 Manila). */
  newDueDate: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  /** The organization whose account decides it, as appeal-rules.ts routes it (checked). */
  decider: string;
}

export interface DemoAnnouncement {
  org: string;
  title: string;
  body: string;
  publishedAt: Date;
}

/** A notification for an organization's account; `project` links it to a demo project. */
export interface DemoNotification {
  org: string;
  kind: NotificationKind;
  title: string;
  body: string;
  project?: string;
  link?: string;
  createdAt: Date;
  read: boolean;
}

/** What the audit trail would hold for the demo blocks, freezes and appeals. */
export interface DemoAuditEntry {
  action: 'project_block' | 'org_freeze' | 'org_unfreeze' | 'appeal_submit' | 'approve' | 'reject';
  /** The organization the entry is about. */
  org: string;
  /** The account that acted, by its organization; null for the compliance checks. */
  actor: string | null;
  entity: { project: string } | { freeze: string } | { appeal: string };
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface DemoPlan {
  /** Every organization the plan touches. */
  organizations: string[];
  projects: DemoProject[];
  freezes: DemoFreeze[];
  appeals: DemoAppeal[];
  announcements: DemoAnnouncement[];
  notifications: DemoNotification[];
  audit: DemoAuditEntry[];
  /** The earlier standings the rank arrows compare against: the boards as they stood then. */
  previousStandingsAt: Date;
}

/** A Manila wall-clock time on a `YYYY-MM-DD` date. */
export function manilaAt(isoDate: string, hour: number, minute = 0): Date {
  const pad = (n: number) => String(n).padStart(2, '0');
  return new Date(`${isoDate}T${pad(hour)}:${pad(minute)}:00+08:00`);
}

const pesos = (amount: number) => Math.round(amount * 100);
const manilaDay = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeZone: 'Asia/Manila',
});
const day = (at: Date) => manilaDay.format(at);

/**
 * The demo data as of `now`. SBO standings come out as ASIT, TAG, ISO, then JPICE, IECEP,
 * UAPSA, PSME, JIIEE, for any late value from 0 to 1:
 * - ASIT 4 on time (₱18,500) and TAG 4 with 1 late (₱12,000): tied at 4 points when a late
 *   project counts fully, so profit puts ASIT first;
 * - ISO 3 on time (₱9,500): tied with TAG at 3 when a late project counts nothing, and
 *   behind it on profit;
 * - the CEA SBOs have 1 or 2. JPICE and UAPSA each completed one in the last week, so
 *   against the standings a week ago they moved up and IECEP and PSME down.
 * CSCs: CSC-CEA, CSC-CCIS, CSC-COM (up one this week), CSC-CoED, CSC-CAT.
 *
 * Completed projects fall in the current semester: their event days are counted back from
 * today and never before the semester's first day, so early in a semester several share it
 * (and fewer rank changes show).
 */
export function planDemoData(now: Date): DemoPlan {
  const today = manilaDate(now);
  const semesterStart = semesterRange(
    currentSemesterKey(now).academicYear,
    currentSemesterKey(now).semester,
  ).start;
  const ago = (days: number) => addDays(today, -days);
  /** An event day in this semester, `days` before today. */
  const eventDay = (days: number) => (ago(days) < semesterStart ? semesterStart : ago(days));
  /** Never in the future: a report "submitted" today is submitted a few minutes ago. */
  const settled = (at: Date) => new Date(Math.min(at.getTime(), now.getTime() - 10 * 60_000));

  const projects: DemoProject[] = [];
  const details = (org: string, name: string, location: string) => ({
    org,
    name,
    location,
    beneficiaries: 'Members and partner students',
    description: `Sample project for demonstrations: ${name}. Not a real event.`,
  });

  /** Implemented: proposal, ACR and Financial Report submitted, with figures. */
  function completed(
    key: string,
    org: string,
    name: string,
    daysAgo: number,
    [income, expenses]: [number, number],
    { late = false }: { late?: boolean } = {},
  ) {
    const targetDate = eventDay(daysAgo);
    projects.push({
      key,
      ...details(org, name, 'NwSSU Main Campus'),
      createdAt: manilaAt(addDays(targetDate, -21), 9),
      targetDate,
      nomRequired: false,
      communicationLetterRequired: false,
      submitted: {
        // Late: filed two days after its 14-day deadline (spec 5C).
        PROPOSAL: manilaAt(addDays(targetDate, late ? -5 : -18), late ? 15 : 14),
        ACR: settled(manilaAt(addDays(targetDate, 2), 16)),
        FINANCIAL_REPORT: settled(manilaAt(addDays(targetDate, 3), 11)),
      },
      figures: { incomeCentavos: pesos(income), expensesCentavos: pesos(expenses) },
    });
  }

  /** The proposal is in; the NOM and Communication Letter are open. */
  function preEvent(key: string, org: string, name: string) {
    projects.push({
      key,
      ...details(org, name, 'NwSSU Audio-Visual Room'),
      createdAt: manilaAt(ago(6), 10),
      targetDate: addDays(today, 12),
      nomRequired: true,
      communicationLetterRequired: true,
      submitted: { PROPOSAL: manilaAt(ago(4), 15) },
      figures: null,
    });
  }

  /** Just created: only the proposal is open. */
  function upcoming(key: string, org: string, name: string) {
    projects.push({
      key,
      ...details(org, name, 'NwSSU Gymnasium'),
      createdAt: manilaAt(ago(2), 9),
      targetDate: addDays(today, 30),
      nomRequired: false,
      communicationLetterRequired: false,
      submitted: {},
      figures: null,
    });
  }

  /** Created `createdDaysAgo` days ago and its proposal never filed: blocked (spec 3A). */
  function blocked(key: string, org: string, name: string, createdDaysAgo: number, inDays: number) {
    projects.push({
      key,
      ...details(org, name, 'Partner barangay hall'),
      createdAt: manilaAt(ago(createdDaysAgo), 10),
      targetDate: addDays(today, inDays),
      nomRequired: false,
      communicationLetterRequired: false,
      submitted: {},
      figures: null,
    });
  }

  /** Its event was `daysAgo` days ago and its post-event reports are overdue (spec 3B). */
  function overdue(
    key: string,
    org: string,
    name: string,
    daysAgo: number,
    filed: Partial<Record<ProjectTaskType, Date>>,
  ) {
    projects.push({
      key,
      ...details(org, name, 'NwSSU Covered Court'),
      createdAt: manilaAt(ago(daysAgo + 20), 9),
      targetDate: ago(daysAgo),
      nomRequired: false,
      communicationLetterRequired: false,
      submitted: { PROPOSAL: manilaAt(ago(daysAgo + 17), 14), ...filed },
      figures: null,
    });
  }

  // CCIS SBOs: the Top 3.
  completed('asit-1', 'asit', 'Hour of Code Outreach', 62, [12_000, 7_000]);
  completed('asit-2', 'asit', 'Web Development Bootcamp', 45, [9_500, 5_000]);
  completed('asit-3', 'asit', 'IT Week Hackathon', 30, [15_000, 9_000]);
  completed('asit-4', 'asit', 'Cybersecurity Awareness Talk', 12, [6_500, 3_500]);
  preEvent('asit-pre', 'asit', 'Mobile App Design Sprint');
  upcoming('asit-next', 'asit', 'Alumni Tech Career Talk');
  blocked('asit-blocked', 'asit', 'Barangay Digital Literacy Drive', 20, 9);

  completed('tag-1', 'tag', '2D Animation Workshop', 58, [8_000, 5_000]);
  completed('tag-2', 'tag', 'Character Design Clinic', 40, [6_000, 3_500], { late: true });
  completed('tag-3', 'tag', 'Stop-Motion Film Showing', 26, [10_000, 6_000]);
  completed('tag-4', 'tag', 'Storyboard Jam', 14, [5_500, 3_000]);
  preEvent('tag-pre', 'tag', 'Animation Festival 2026');
  upcoming('tag-next', 'tag', 'Blender Basics Workshop');
  blocked('tag-blocked', 'tag', 'Inter-school Animation Exchange', 26, 4);

  completed('iso-1', 'iso', 'Systems Analysis Seminar', 55, [7_000, 3_500]);
  completed('iso-2', 'iso', 'Database Design Workshop', 35, [5_000, 2_500]);
  completed('iso-3', 'iso', 'ERP Industry Visit', 16, [9_000, 5_500]);
  preEvent('iso-pre', 'iso', 'IS Research Colloquium');
  upcoming('iso-next', 'iso', 'Data Analytics Bootcamp');
  overdue('iso-frozen', 'iso', 'Community Inventory System Turnover', 20, {});

  // CEA SBOs: rows 4 and below. "Recent" ones completed this week.
  completed('jpice-1', 'jpice', 'Bridge Model Competition', 50, [8_000, 4_500]);
  completed('jpice-2', 'jpice', 'Surveying Field Day', 4, [6_000, 3_500]);
  completed('iecep-1', 'iecep', 'Circuit Design Contest', 48, [5_000, 3_000]);
  completed('iecep-2', 'iecep', 'Electronics Fair', 22, [6_200, 4_000]);
  completed('uapsa-1', 'uapsa', 'Campus Sketch Walk', 38, [4_000, 2_800]);
  completed('uapsa-2', 'uapsa', 'Design Charrette', 4, [4_500, 2_700]);
  completed('psme-1', 'psme', 'Plant Visit Briefing', 33, [6_000, 3_500]);
  completed('jiiee-1', 'jiiee', 'Wiring Safety Seminar', 27, [3_000, 2_200]);

  // CSCs.
  completed('csc-cea-1', 'csc-cea', 'Freshmen Orientation', 70, [10_000, 4_000]);
  completed('csc-cea-2', 'csc-cea', 'CEA Days 2026', 60, [12_000, 8_000]);
  completed('csc-cea-3', 'csc-cea', 'Engineering Leadership Forum', 36, [9_000, 4_000]);
  completed('csc-ccis-1', 'csc-ccis', 'CCIS Week 2026', 44, [11_000, 6_000]);
  completed('csc-ccis-2', 'csc-ccis', 'Tech Leadership Summit', 24, [8_000, 4_000]);
  overdue('csc-ccis-frozen', 'csc-ccis', 'CCIS Sportsfest', 18, {
    ACR: manilaAt(ago(15), 10),
  });
  completed('csc-com-1', 'csc-com', 'Business Plan Pitch', 52, [7_000, 4_000]);
  completed('csc-com-2', 'csc-com', 'Marketing Expo', 4, [8_000, 4_500]);
  completed('csc-coed-1', 'csc-coed', 'Teaching Demo Day', 34, [9_000, 5_000]);
  completed('csc-cat-1', 'csc-cat', 'Agri-Tech Fair', 29, [5_000, 3_000]);

  const byKey = new Map(projects.map((p) => [p.key, p]));
  const project = (key: string) => byKey.get(key)!;
  const proposalDue = (key: string) => deadlineAfter(project(key).createdAt);
  const postEventDue = (key: string) => deadlineAfter(project(key).targetDate);
  /** The hourly check freezes within the hour after the deadline. */
  const frozenAt = (key: string) => new Date(postEventDue(key).getTime() + 30 * 60_000);

  const freezes: DemoFreeze[] = [
    {
      key: 'iso-freeze',
      project: 'iso-frozen',
      reports: ['ACR', 'FINANCIAL_REPORT'],
      frozenAt: frozenAt('iso-frozen'),
      liftedAt: manilaAt(ago(2), 10),
    },
    {
      key: 'csc-ccis-freeze',
      project: 'csc-ccis-frozen',
      reports: ['FINANCIAL_REPORT'],
      frozenAt: frozenAt('csc-ccis-frozen'),
      liftedAt: null,
    },
  ];

  const appeals: DemoAppeal[] = [
    {
      key: 'asit-appeal',
      type: 'PROJECT_BLOCK',
      project: 'asit-blocked',
      freeze: null,
      reason:
        'Our adviser was on leave during the proposal period, so the signed proposal could not be filed in time. The signed copy is ready for upload.',
      status: 'pending',
      remarks: null,
      newDueDate: null,
      createdAt: manilaAt(ago(4), 13),
      decidedAt: null,
      decider: 'csc-ccis',
    },
    {
      key: 'iso-appeal',
      type: 'ORG_FREEZE',
      project: 'iso-frozen',
      freeze: 'iso-freeze',
      reason:
        'The partner office has not yet released the turnover receipts we need for the ACR and Financial Report. They confirmed release within the week.',
      status: 'approved',
      remarks: 'Approved. Submit both reports by the new deadline; no further extension.',
      newDueDate: addDays(today, 7),
      createdAt: manilaAt(ago(4), 14),
      decidedAt: manilaAt(ago(2), 10),
      decider: 'csc-ccis',
    },
    {
      key: 'tag-appeal',
      type: 'PROJECT_BLOCK',
      project: 'tag-blocked',
      freeze: null,
      reason: 'We were waiting for the partner school to confirm the exchange date.',
      status: 'rejected',
      remarks:
        'The proposal does not depend on the partner confirming a date. File the proposal with a tentative date and appeal again.',
      newDueDate: null,
      createdAt: manilaAt(ago(9), 11),
      decidedAt: manilaAt(ago(7), 15),
      decider: 'csc-ccis',
    },
    {
      key: 'csc-ccis-appeal',
      type: 'ORG_FREEZE',
      project: 'csc-ccis-frozen',
      freeze: 'csc-ccis-freeze',
      reason:
        'The Financial Report is waiting for the last liquidation from the sports committee. We ask for one more week.',
      status: 'pending',
      remarks: null,
      newDueDate: null,
      createdAt: manilaAt(ago(2), 9),
      decidedAt: null,
      decider: 'issc',
    },
  ];

  const appeal = (key: string) => appeals.find((a) => a.key === key)!;
  const blockedTitle = (key: string) => `${project(key).name} is blocked`;
  const blockedBody = (key: string) =>
    `The Project Proposal for ${project(key).name} was due ${day(proposalDue(key))} and was not submitted, so the project is blocked and its tasks are locked. Submit an appeal to unblock it.`;
  const submittedTitle = (org: string, key: string) =>
    `${org} appealed: ${APPEAL_TYPE_LABELS[appeal(key).type].toLowerCase()}`;
  const submittedBody = (org: string, key: string) =>
    `${org} submitted an appeal about ${project(appeal(key).project).name}. It is waiting for your decision.`;
  const afterDeadline = (at: Date) => new Date(at.getTime() + 60 * 60_000);

  const notifications: DemoNotification[] = [
    {
      org: 'asit',
      kind: 'deadline_missed',
      title: blockedTitle('asit-blocked'),
      body: blockedBody('asit-blocked'),
      project: 'asit-blocked',
      createdAt: afterDeadline(proposalDue('asit-blocked')),
      read: false,
    },
    {
      org: 'tag',
      kind: 'deadline_missed',
      title: blockedTitle('tag-blocked'),
      body: blockedBody('tag-blocked'),
      project: 'tag-blocked',
      createdAt: afterDeadline(proposalDue('tag-blocked')),
      read: true,
    },
    {
      org: 'tag',
      kind: 'appeal_decided',
      title: `Appeal rejected: ${project('tag-blocked').name}`,
      body: `CSC-CCIS rejected your appeal about ${project('tag-blocked').name}. Remarks: ${appeal('tag-appeal').remarks} You can appeal again.`,
      project: 'tag-blocked',
      createdAt: appeal('tag-appeal').decidedAt!,
      read: false,
    },
    {
      org: 'iso',
      kind: 'deadline_missed',
      title: 'ISO is frozen',
      body: `The ${PROJECT_TASK_LABELS.ACR} and ${PROJECT_TASK_LABELS.FINANCIAL_REPORT} for ${project('iso-frozen').name} were due ${day(postEventDue('iso-frozen'))} and were not submitted. ISO cannot create new projects until an appeal is approved.`,
      link: '/dashboard',
      createdAt: frozenAt('iso-frozen'),
      read: true,
    },
    {
      org: 'iso',
      kind: 'appeal_decided',
      title: `Appeal approved: ${project('iso-frozen').name}`,
      body: `CSC-CCIS approved your appeal about ${project('iso-frozen').name}. The new deadline is ${appeal('iso-appeal').newDueDate}. Remarks: ${appeal('iso-appeal').remarks}`,
      project: 'iso-frozen',
      createdAt: appeal('iso-appeal').decidedAt!,
      read: false,
    },
    {
      org: 'csc-ccis',
      kind: 'appeal_submitted',
      title: submittedTitle('ASIT', 'asit-appeal'),
      body: submittedBody('ASIT', 'asit-appeal'),
      link: '/dashboard/appeals',
      createdAt: appeal('asit-appeal').createdAt,
      read: false,
    },
    {
      org: 'csc-ccis',
      kind: 'deadline_missed',
      title: 'CSC-CCIS is frozen',
      body: `The ${PROJECT_TASK_LABELS.FINANCIAL_REPORT} for ${project('csc-ccis-frozen').name} was due ${day(postEventDue('csc-ccis-frozen'))} and was not submitted. CSC-CCIS cannot create new projects until an appeal is approved.`,
      link: '/dashboard',
      createdAt: frozenAt('csc-ccis-frozen'),
      read: true,
    },
    {
      org: 'issc',
      kind: 'appeal_submitted',
      title: submittedTitle('CSC-CCIS', 'csc-ccis-appeal'),
      body: submittedBody('CSC-CCIS', 'csc-ccis-appeal'),
      link: '/dashboard/appeals',
      createdAt: appeal('csc-ccis-appeal').createdAt,
      read: false,
    },
  ];

  const announcements: DemoAnnouncement[] = [
    {
      org: 'issc',
      title: 'Semestral End Report generation is open',
      body: 'Organizations can now generate their Semestral End Report from the dashboard. Make sure every project task is submitted before generating. (Sample announcement for demonstrations.)',
      publishedAt: manilaAt(ago(2), 9),
    },
    {
      org: 'issc',
      title: 'Leadership Summit registration',
      body: 'Each organization may send two officers to this semester’s Leadership Summit. Register through your CSC. (Sample announcement for demonstrations.)',
      publishedAt: manilaAt(ago(9), 10),
    },
    {
      org: 'issc',
      title: 'Reminder: post-event reports are due in 14 days',
      body: 'The Activity Completion Report and Financial Report of every project are due 14 days after its event. Late reports freeze the organization until an appeal is approved. (Sample announcement for demonstrations.)',
      publishedAt: manilaAt(ago(20), 8, 30),
    },
    {
      org: 'csc-ccis',
      title: 'CCIS Week booth applications',
      body: 'CCIS student body organizations can apply for a booth at CCIS Week. Submit your booth plan to the CSC office. (Sample announcement for demonstrations.)',
      publishedAt: manilaAt(ago(5), 14),
    },
  ];

  const audit: DemoAuditEntry[] = [
    ...(['asit-blocked', 'tag-blocked'] as const).map((key): DemoAuditEntry => ({
      action: 'project_block',
      org: project(key).org,
      actor: null,
      entity: { project: key },
      metadata: { proposalDueAt: proposalDue(key).toISOString() },
      createdAt: afterDeadline(proposalDue(key)),
    })),
    ...freezes.map((f): DemoAuditEntry => ({
      action: 'org_freeze',
      org: project(f.project).org,
      actor: null,
      entity: { freeze: f.key },
      metadata: { reports: f.reports, postEventDueAt: postEventDue(f.project).toISOString() },
      createdAt: f.frozenAt,
    })),
    ...appeals.flatMap((a): DemoAuditEntry[] => {
      const org = project(a.project).org;
      const entries: DemoAuditEntry[] = [
        {
          action: 'appeal_submit',
          org,
          actor: org,
          entity: { appeal: a.key },
          metadata: { type: a.type, attachments: 0 },
          createdAt: a.createdAt,
        },
      ];
      if (a.status === 'pending') return entries;
      entries.push({
        action: a.status === 'approved' ? 'approve' : 'reject',
        org,
        actor: a.decider,
        entity: { appeal: a.key },
        metadata: {
          type: a.type,
          authority: 'seat',
          ...(a.newDueDate && { newDueAt: endOfManilaDay(a.newDueDate).toISOString() }),
        },
        createdAt: a.decidedAt!,
      });
      if (a.status === 'approved' && a.freeze) {
        entries.push({
          action: 'org_unfreeze',
          org,
          actor: a.decider,
          entity: { freeze: a.freeze },
          metadata: { postEventDueAt: endOfManilaDay(a.newDueDate!).toISOString() },
          createdAt: a.decidedAt!,
        });
      }
      return entries;
    }),
  ];

  return {
    organizations: [...new Set(projects.map((p) => p.org)), 'issc'],
    projects,
    freezes,
    appeals,
    announcements,
    notifications,
    audit,
    previousStandingsAt: new Date(now.getTime() - 7 * 24 * 60 * 60_000),
  };
}

/** The deadlines the plan's approved appeals set on each project, as the appeal flow does. */
export function demoOverrides(
  plan: DemoPlan,
): Map<string, { proposalDueOverride?: Date; postEventDueOverride?: Date }> {
  const overrides = new Map<string, { proposalDueOverride?: Date; postEventDueOverride?: Date }>();
  for (const a of plan.appeals) {
    if (a.status !== 'approved' || !a.newDueDate) continue;
    const p = plan.projects.find((x) => x.key === a.project)!;
    overrides.set(
      p.key,
      deadlinesAfterApproval(
        a.type,
        { postEventDueAt: deadlineAfter(p.targetDate) },
        endOfManilaDay(a.newDueDate),
      ),
    );
  }
  return overrides;
}

/** A demo project's checklist and status, by the real unlock and compliance rules. */
export function planDemoProject(
  project: DemoProject,
  overrides: { proposalDueOverride?: Date; postEventDueOverride?: Date } | undefined,
  exemptFromCompliance: boolean,
  now: Date,
): ProjectPlan {
  return planProject(
    {
      createdAt: project.createdAt,
      targetDate: project.targetDate,
      nomRequired: project.nomRequired,
      momRequired: false,
      communicationLetterRequired: project.communicationLetterRequired,
      attendanceSheetRequired: false,
      proposalDueOverride: overrides?.proposalDueOverride ?? null,
      postEventDueOverride: overrides?.postEventDueOverride ?? null,
      filed: new Set(Object.keys(project.submitted) as ProjectTaskType[]),
      exemptFromCompliance,
    },
    now,
  );
}

/**
 * The standings' input as it stood at an earlier instant: only what was submitted by then.
 * Ranked at that instant, it gives the earlier snapshot the rank arrows compare against.
 */
export function standingFactsAsOf(records: StandingOrgRecord[], at: Date): StandingOrgRecord[] {
  return records.map((org) => ({
    ...org,
    projects: org.projects.map((p) => ({
      ...p,
      tasks: p.tasks.filter((t) => t.submittedAt !== null && t.submittedAt <= at),
    })),
  }));
}

export type DemoGuardVerdict = 'ok' | 'allowed' | 'refuse';

/**
 * Whether a process may start with this much demo data (docs/DEPLOYMENT.md). In production
 * any demo row refuses the start, unless ALLOW_DEMO_DATA=true says so explicitly.
 */
export function demoDataGuard({
  nodeEnv,
  allowDemoData,
  demoRows,
}: {
  nodeEnv: string;
  allowDemoData: boolean;
  demoRows: number;
}): DemoGuardVerdict {
  if (nodeEnv !== 'production' || demoRows === 0) return 'ok';
  return allowDemoData ? 'allowed' : 'refuse';
}
