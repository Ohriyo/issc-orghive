import {
  daysBetween,
  deadlineAfter,
  DEADLINE_REMINDER_DAYS,
  manilaDate,
  type ProjectStatus,
  type ProjectTaskStatus,
  type ProjectTaskType,
} from '@orghive/shared';

/** What the unlock and compliance rules need to know about a project. */
export interface ProjectFacts {
  createdAt: Date;
  /** The event date in Manila, `YYYY-MM-DD`. */
  targetDate: string;
  nomRequired: boolean;
  momRequired: boolean;
  /** A proposal deadline an approved appeal set, replacing the 14 days. */
  proposalDueOverride: Date | null;
  /** A post-event deadline an approved appeal set, replacing the 14 days. */
  postEventDueOverride: Date | null;
  /** Task types whose file is uploaded and passed the virus scan. */
  filed: ReadonlySet<ProjectTaskType>;
  /**
   * The ISSC's projects: never blocked and never overdue, since nobody decides the ISSC's
   * appeals (appeal-rules.ts). Deadlines still show.
   */
  exemptFromCompliance: boolean;
}

export interface PlannedTask {
  type: ProjectTaskType;
  status: ProjectTaskStatus;
  /** Null for tasks without a deadline (NOM and MOM). */
  dueAt: Date | null;
}

export interface ProjectPlan {
  status: ProjectStatus;
  proposalDueAt: Date;
  postEventDueAt: Date;
  /** In checklist order. NOM and MOM appear only when the project needs them. */
  tasks: PlannedTask[];
  /**
   * Post-event reports missing after their deadline: the organization is frozen (spec 3B).
   * Empty while the project is blocked, since its reports are locked then.
   */
  overdueReports: ProjectTaskType[];
}

const POST_EVENT: readonly ProjectTaskType[] = ['ACR', 'FINANCIAL_REPORT'];

/**
 * Every unlock and compliance rule of a project (docs/PROJECT_WORKFLOW_SPEC.md, sections 2B
 * and 3), in one pure function. Deadlines are 23:59:59 Manila time on day 14
 * (docs/DOMAIN_RULES.md), unless an approved appeal set a new one.
 * - PROPOSAL: open from creation, due 14 days after it.
 * - NOM, MOM: only when the project needs them; locked until the proposal is submitted.
 *   No deadline.
 * - ACR, FINANCIAL_REPORT: locked until the target date (Manila), due 14 days after it.
 * - Any task whose file is uploaded and clean is submitted. Nobody reviews it.
 * - Blocked (3A): the proposal is not submitted by its deadline. Every task that is not
 *   submitted is locked until an appeal moves the deadline.
 * - Overdue reports (3B): the ACR or Financial Report is not submitted by its deadline.
 * - Completed once every task the project needs is submitted.
 * - The ISSC is exempt: its projects never block and its reports never freeze it.
 */
export function planProject(facts: ProjectFacts, now: Date): ProjectPlan {
  const proposalDueAt = facts.proposalDueOverride ?? deadlineAfter(facts.createdAt);
  const postEventDueAt = facts.postEventDueOverride ?? deadlineAfter(facts.targetDate);
  const eventReached = manilaDate(now) >= facts.targetDate;
  const proposalFiled = facts.filed.has('PROPOSAL');
  const blocked = !facts.exemptFromCompliance && !proposalFiled && now > proposalDueAt;

  const task = (type: ProjectTaskType, unlocked: boolean, dueAt: Date | null): PlannedTask => ({
    type,
    status: facts.filed.has(type) ? 'submitted' : unlocked && !blocked ? 'open' : 'locked',
    dueAt,
  });

  const tasks: PlannedTask[] = [
    task('PROPOSAL', true, proposalDueAt),
    ...(facts.nomRequired ? [task('NOM', proposalFiled, null)] : []),
    ...(facts.momRequired ? [task('MOM', proposalFiled, null)] : []),
    task('ACR', eventReached, postEventDueAt),
    task('FINANCIAL_REPORT', eventReached, postEventDueAt),
  ];

  const allSubmitted = tasks.every((t) => t.status === 'submitted');
  const status: ProjectStatus = blocked ? 'blocked' : allSubmitted ? 'completed' : 'active';
  const overdueReports =
    facts.exemptFromCompliance || blocked || now <= postEventDueAt
      ? []
      : POST_EVENT.filter((type) => !facts.filed.has(type));

  return { status, proposalDueAt, postEventDueAt, tasks, overdueReports };
}

/** The earliest deadline among open tasks, or null when nothing is due. */
export function nextDeadline(plan: ProjectPlan): { type: ProjectTaskType; dueAt: Date } | null {
  let next: { type: ProjectTaskType; dueAt: Date } | null = null;
  for (const t of plan.tasks) {
    if (t.status !== 'open' || !t.dueAt) continue;
    if (!next || t.dueAt < next.dueAt) next = { type: t.type, dueAt: t.dueAt };
  }
  return next;
}

/**
 * Open tasks due within `DEADLINE_REMINDER_DAYS` Manila calendar days and not yet past due:
 * the "deadline in 3 days" reminder. Its dedupe key includes the due date, so a deadline
 * an appeal moved is announced again.
 */
export function deadlinesSoon(
  plan: ProjectPlan,
  now: Date,
): { type: ProjectTaskType; dueAt: Date }[] {
  const today = manilaDate(now);
  return plan.tasks.flatMap((t) =>
    t.status === 'open' &&
    t.dueAt &&
    now <= t.dueAt &&
    daysBetween(today, manilaDate(t.dueAt)) <= DEADLINE_REMINDER_DAYS
      ? [{ type: t.type, dueAt: t.dueAt }]
      : [],
  );
}

/**
 * The deadlines an approved appeal sets: the new date for what was appealed. Unblocking a
 * project also moves its post-event deadline when that would come first, so the reports
 * it could not file while blocked are not overdue the moment it unblocks.
 */
export function deadlinesAfterApproval(
  type: 'PROJECT_BLOCK' | 'ORG_FREEZE',
  current: { postEventDueAt: Date },
  newDueAt: Date,
): { proposalDueOverride?: Date; postEventDueOverride?: Date } {
  if (type === 'ORG_FREEZE') return { postEventDueOverride: newDueAt };
  return current.postEventDueAt < newDueAt
    ? { proposalDueOverride: newDueAt, postEventDueOverride: newDueAt }
    : { proposalDueOverride: newDueAt };
}
