import {
  daysBetween,
  manilaDate,
  PROJECT_TASK_LABELS,
  type ProjectStatus,
  type ProjectTaskType,
} from '@orghive/shared';

/** How urgent a deadline is: drives the badge's color and icon, never color alone. */
export type DeadlineTone = 'neutral' | 'soon' | 'overdue';

export interface DeadlineLabel {
  /** "Due in 5 days", "Due today", "Overdue by 2 days". */
  text: string;
  tone: DeadlineTone;
  /** "Oct 15, 2026", for a <time> element's visible date. */
  date: string;
  iso: string;
}

/** Within this many days a deadline is flagged as soon. */
export const SOON_DAYS = 3;

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: 'In progress',
  blocked: 'Blocked',
  completed: 'Completed',
};

const dateFormat = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeZone: 'Asia/Manila',
});

/** A calendar date (`YYYY-MM-DD`) or an instant, shown as a Manila date. */
export function formatManilaDate(value: string): string {
  const instant = value.length === 10 ? new Date(`${value}T12:00:00+08:00`) : new Date(value);
  return dateFormat.format(instant);
}

/** Counted in Manila calendar days, the way the deadlines are (docs/DOMAIN_RULES.md). */
export function deadlineLabel(dueAt: string, now: Date): DeadlineLabel {
  const days = daysBetween(manilaDate(now), manilaDate(new Date(dueAt)));
  const past = new Date(dueAt).getTime() < now.getTime();
  const text = past
    ? days === 0
      ? 'Overdue'
      : `Overdue by ${-days} ${days === -1 ? 'day' : 'days'}`
    : days === 0
      ? 'Due today'
      : days === 1
        ? 'Due tomorrow'
        : `Due in ${days} days`;
  return {
    text,
    tone: past ? 'overdue' : days <= SOON_DAYS ? 'soon' : 'neutral',
    date: formatManilaDate(dueAt),
    iso: dueAt,
  };
}

/** Why a task is locked, in words. */
export function lockedHint(type: ProjectTaskType, targetDate: string): string {
  if (type === 'PROPOSAL') return 'Locked while the project is blocked.';
  if (type === 'ACR' || type === 'FINANCIAL_REPORT') {
    return `Opens on the event day, ${formatManilaDate(targetDate)}.`;
  }
  return 'Unlocks once the Project Proposal is submitted.';
}

/** When a pre-event document is due, in words, shown whatever its state (spec 2B). */
export const TASK_NOTES: Partial<Record<ProjectTaskType, string>> = {
  COMMUNICATION_LETTER: 'Due by the end of the event day. Add one file for each office.',
  ATTENDANCE_SHEET:
    'Signed during the event, so it is due with the Activity Completion Report, 14 days after.',
  OTHER_PRE_EVENT: 'Optional, for anything else you prepared. Not counted for deadlines.',
};

/** "Next: Project Proposal, due in 5 days". */
export function nextDeadlineText(next: { type: ProjectTaskType; dueAt: string }, now: Date) {
  return `${PROJECT_TASK_LABELS[next.type]}: ${deadlineLabel(next.dueAt, now).text.toLowerCase()}`;
}
