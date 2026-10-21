import { describe, expect, it } from 'vitest';
import type { ProjectTaskType } from '@orghive/shared';
import {
  deadlinesAfterApproval,
  deadlinesSoon,
  nextDeadline,
  planProject,
  type ProjectFacts,
} from '#src/services/project-rules';

// Created Oct 1, 10:00 Manila; event on Oct 20. Proposal due Oct 15, reports due Nov 3.
const CREATED = new Date('2026-10-01T02:00:00Z');
const BEFORE_EVENT = new Date('2026-10-10T02:00:00Z');
/** Oct 20, 00:30 Manila: the event day has started there (still Oct 19 in UTC). */
const EVENT_DAY = new Date('2026-10-19T16:30:00Z');
/** Oct 19, 23:30 Manila: not yet. */
const EVE = new Date('2026-10-19T15:30:00Z');
/** The proposal deadline: Oct 15, 23:59:59.999 Manila. */
const PROPOSAL_DUE = new Date('2026-10-15T15:59:59.999Z');
/** The post-event deadline: Nov 3, 23:59:59.999 Manila. */
const REPORTS_DUE = new Date('2026-11-03T15:59:59.999Z');
const ms = (at: Date, delta: number) => new Date(at.getTime() + delta);

function facts(overrides: Partial<ProjectFacts> = {}, filed: ProjectTaskType[] = []): ProjectFacts {
  return {
    createdAt: CREATED,
    targetDate: '2026-10-20',
    nomRequired: false,
    momRequired: false,
    communicationLetterRequired: false,
    attendanceSheetRequired: false,
    exemptFromCompliance: false,
    proposalDueOverride: null,
    postEventDueOverride: null,
    filed: new Set(filed),
    ...overrides,
  };
}

const statuses = (plan: ReturnType<typeof planProject>) =>
  Object.fromEntries(plan.tasks.map((t) => [t.type, t.status]));

describe('planProject: on creation', () => {
  it('opens the proposal, due at 23:59:59 Manila on day 14, and locks the reports', () => {
    const plan = planProject(facts(), CREATED);
    expect(statuses(plan)).toEqual({
      PROPOSAL: 'open',
      OTHER_PRE_EVENT: 'locked',
      ACR: 'locked',
      FINANCIAL_REPORT: 'locked',
    });
    expect(plan.tasks[0]!.dueAt).toEqual(PROPOSAL_DUE);
    expect(plan.proposalDueAt).toEqual(PROPOSAL_DUE);
    expect(plan.status).toBe('active');
    expect(plan.overdueReports).toEqual([]);
  });

  it('dates the post-event reports 14 days after the target date', () => {
    const plan = planProject(facts(), CREATED);
    const acr = plan.tasks.find((t) => t.type === 'ACR')!;
    const financial = plan.tasks.find((t) => t.type === 'FINANCIAL_REPORT')!;
    expect(acr.dueAt).toEqual(REPORTS_DUE);
    expect(financial.dueAt).toEqual(acr.dueAt);
    expect(plan.postEventDueAt).toEqual(acr.dueAt);
  });

  it('adds NOM and MOM only when the project needs them, locked and without a deadline', () => {
    expect(planProject(facts(), CREATED).tasks.map((t) => t.type)).toEqual([
      'PROPOSAL',
      'OTHER_PRE_EVENT',
      'ACR',
      'FINANCIAL_REPORT',
    ]);
    const both = planProject(facts({ nomRequired: true, momRequired: true }), CREATED);
    expect(both.tasks.map((t) => t.type)).toEqual([
      'PROPOSAL',
      'NOM',
      'MOM',
      'OTHER_PRE_EVENT',
      'ACR',
      'FINANCIAL_REPORT',
    ]);
    expect(statuses(both)).toMatchObject({ NOM: 'locked', MOM: 'locked' });
    expect(both.tasks.find((t) => t.type === 'NOM')!.dueAt).toBeNull();
    expect(planProject(facts({ momRequired: true }), CREATED).tasks.map((t) => t.type)).toEqual([
      'PROPOSAL',
      'MOM',
      'OTHER_PRE_EVENT',
      'ACR',
      'FINANCIAL_REPORT',
    ]);
  });
});

/** Every pre-event document ticked (spec 2B, 2026-10-21). */
const ALL_TICKED: Partial<ProjectFacts> = {
  nomRequired: true,
  momRequired: true,
  communicationLetterRequired: true,
  attendanceSheetRequired: true,
};
/** The end of the event day: Oct 20, 23:59:59.999 Manila. */
const EVENT_DAY_END = new Date('2026-10-20T15:59:59.999Z');
const task = (plan: ReturnType<typeof planProject>, type: ProjectTaskType) =>
  plan.tasks.find((t) => t.type === type)!;

describe('planProject: pre-event documents (spec 2B)', () => {
  it('lists the ticked ones in checklist order, Attendance Sheet with the pre-event files', () => {
    expect(planProject(facts(ALL_TICKED), CREATED).tasks.map((t) => t.type)).toEqual([
      'PROPOSAL',
      'NOM',
      'MOM',
      'COMMUNICATION_LETTER',
      'ATTENDANCE_SHEET',
      'OTHER_PRE_EVENT',
      'ACR',
      'FINANCIAL_REPORT',
    ]);
  });

  it('leaves out the Communication Letter and Attendance Sheet unless ticked', () => {
    const types = planProject(facts({ attendanceSheetRequired: true }), CREATED).tasks.map(
      (t) => t.type,
    );
    expect(types).toContain('ATTENDANCE_SHEET');
    expect(types).not.toContain('COMMUNICATION_LETTER');
    expect(planProject(facts(), CREATED).tasks.map((t) => t.type)).not.toContain(
      'ATTENDANCE_SHEET',
    );
  });

  it('locks every pre-event document until the proposal is submitted, like NOM and MOM', () => {
    expect(statuses(planProject(facts(ALL_TICKED), BEFORE_EVENT))).toMatchObject({
      NOM: 'locked',
      MOM: 'locked',
      COMMUNICATION_LETTER: 'locked',
      ATTENDANCE_SHEET: 'locked',
      OTHER_PRE_EVENT: 'locked',
    });
    expect(statuses(planProject(facts(ALL_TICKED, ['PROPOSAL']), BEFORE_EVENT))).toMatchObject({
      NOM: 'open',
      MOM: 'open',
      COMMUNICATION_LETTER: 'open',
      ATTENDANCE_SHEET: 'open',
      OTHER_PRE_EVENT: 'open',
      ACR: 'locked',
    });
  });

  it('dates the Communication Letter at the end of the event day', () => {
    expect(task(planProject(facts(ALL_TICKED), CREATED), 'COMMUNICATION_LETTER').dueAt).toEqual(
      EVENT_DAY_END,
    );
  });

  it('dates the Attendance Sheet with the ACR, 14 days after the event', () => {
    const plan = planProject(facts(ALL_TICKED), CREATED);
    expect(task(plan, 'ATTENDANCE_SHEET').dueAt).toEqual(REPORTS_DUE);
    expect(task(plan, 'ATTENDANCE_SHEET').dueAt).toEqual(task(plan, 'ACR').dueAt);
  });

  it('moves both with the event date, and the Attendance Sheet with an appeal override', () => {
    const moved = planProject(facts({ ...ALL_TICKED, targetDate: '2026-10-25' }), CREATED);
    expect(task(moved, 'COMMUNICATION_LETTER').dueAt).toEqual(new Date('2026-10-25T15:59:59.999Z'));
    const override = new Date('2026-11-20T15:59:59.999Z');
    const appealed = planProject(facts({ ...ALL_TICKED, postEventDueOverride: override }), CREATED);
    expect(task(appealed, 'ATTENDANCE_SHEET').dueAt).toEqual(override);
    // An appeal never moves the letter: it is due on the event day.
    expect(task(appealed, 'COMMUNICATION_LETTER').dueAt).toEqual(EVENT_DAY_END);
  });

  it('keeps other pre-event documents optional and undated', () => {
    const other = task(planProject(facts(), CREATED), 'OTHER_PRE_EVENT');
    expect(other).toMatchObject({ required: false, dueAt: null });
    expect(task(planProject(facts(), CREATED), 'PROPOSAL').required).toBe(true);
  });

  it('completes without other pre-event documents, but not without a ticked one', () => {
    const reports: ProjectTaskType[] = ['PROPOSAL', 'NOM', 'MOM', 'ACR', 'FINANCIAL_REPORT'];
    const withLetter = facts(ALL_TICKED, [...reports, 'ATTENDANCE_SHEET']);
    expect(planProject(withLetter, EVENT_DAY).status).toBe('active');
    const all = facts(ALL_TICKED, [...reports, 'ATTENDANCE_SHEET', 'COMMUNICATION_LETTER']);
    expect(planProject(all, EVENT_DAY).status).toBe('completed');
  });

  it('shows the letter as the next deadline before the event, and reminds of it', () => {
    const plan = planProject(facts(ALL_TICKED, ['PROPOSAL']), BEFORE_EVENT);
    expect(nextDeadline(plan)).toEqual({ type: 'COMMUNICATION_LETTER', dueAt: EVENT_DAY_END });
    const threeDaysBefore = new Date('2026-10-17T02:00:00Z');
    expect(
      deadlinesSoon(planProject(facts(ALL_TICKED, ['PROPOSAL']), threeDaysBefore), threeDaysBefore),
    ).toContainEqual({ type: 'COMMUNICATION_LETTER', dueAt: EVENT_DAY_END });
  });

  it('never freezes the organization for a late letter or attendance sheet (points only)', () => {
    const late = ms(REPORTS_DUE, 1);
    const plan = planProject(facts(ALL_TICKED, ['PROPOSAL', 'ACR', 'FINANCIAL_REPORT']), late);
    expect(plan.overdueReports).toEqual([]);
  });

  it('locks them all while the project is blocked', () => {
    expect(statuses(planProject(facts(ALL_TICKED), ms(PROPOSAL_DUE, 1)))).toMatchObject({
      COMMUNICATION_LETTER: 'locked',
      ATTENDANCE_SHEET: 'locked',
      OTHER_PRE_EVENT: 'locked',
    });
  });
});

describe('planProject: transitions', () => {
  it('PROPOSAL open -> submitted once its file is clean', () => {
    expect(statuses(planProject(facts({}, ['PROPOSAL']), BEFORE_EVENT)).PROPOSAL).toBe('submitted');
  });

  it('NOM and MOM locked -> open when the proposal is submitted', () => {
    const needs = { nomRequired: true, momRequired: true };
    expect(statuses(planProject(facts(needs), BEFORE_EVENT))).toMatchObject({
      NOM: 'locked',
      MOM: 'locked',
    });
    expect(statuses(planProject(facts(needs, ['PROPOSAL']), BEFORE_EVENT))).toMatchObject({
      NOM: 'open',
      MOM: 'open',
    });
  });

  it('NOM and MOM open -> submitted once their files are clean', () => {
    const plan = planProject(
      facts({ nomRequired: true, momRequired: true }, ['PROPOSAL', 'NOM']),
      BEFORE_EVENT,
    );
    expect(statuses(plan)).toMatchObject({ NOM: 'submitted', MOM: 'open' });
  });

  it('ACR and Financial Report locked -> open on the target date in Manila', () => {
    expect(statuses(planProject(facts({}, ['PROPOSAL']), EVE))).toMatchObject({
      ACR: 'locked',
      FINANCIAL_REPORT: 'locked',
    });
    expect(statuses(planProject(facts({}, ['PROPOSAL']), EVENT_DAY))).toMatchObject({
      ACR: 'open',
      FINANCIAL_REPORT: 'open',
    });
  });

  it('does not wait for the proposal to unlock the post-event reports', () => {
    // An event on Oct 12, before the Oct 15 proposal deadline.
    const early = facts({ targetDate: '2026-10-12' });
    expect(statuses(planProject(early, new Date('2026-10-12T02:00:00Z')))).toMatchObject({
      PROPOSAL: 'open',
      ACR: 'open',
    });
  });

  it('ACR and Financial Report open -> submitted once their files are clean', () => {
    const plan = planProject(facts({}, ['PROPOSAL', 'ACR']), EVENT_DAY);
    expect(statuses(plan)).toMatchObject({ ACR: 'submitted', FINANCIAL_REPORT: 'open' });
  });

  it('keeps a submitted task submitted even if its unlock condition no longer holds', () => {
    // The target date moved later after the ACR was filed.
    const plan = planProject(facts({ targetDate: '2026-12-01' }, ['PROPOSAL', 'ACR']), EVENT_DAY);
    expect(statuses(plan).ACR).toBe('submitted');
  });
});

describe('planProject: project status', () => {
  it('active -> completed once every task it needs is submitted', () => {
    const all: ProjectTaskType[] = ['PROPOSAL', 'ACR', 'FINANCIAL_REPORT'];
    expect(planProject(facts({}, all.slice(0, 2)), EVENT_DAY).status).toBe('active');
    expect(planProject(facts({}, all), EVENT_DAY).status).toBe('completed');
  });

  it('completed -> active when a newly needed task is still missing', () => {
    const filed: ProjectTaskType[] = ['PROPOSAL', 'ACR', 'FINANCIAL_REPORT'];
    expect(planProject(facts({}, filed), EVENT_DAY).status).toBe('completed');
    expect(planProject(facts({ nomRequired: true }, filed), EVENT_DAY).status).toBe('active');
  });
});

describe('planProject: proposal deadline (spec 3A)', () => {
  it('is not blocked up to the last millisecond of day 14 in Manila', () => {
    expect(planProject(facts(), PROPOSAL_DUE).status).toBe('active');
  });

  it('blocks the project one millisecond later, locking every task not submitted', () => {
    const plan = planProject(facts({ nomRequired: true }), ms(PROPOSAL_DUE, 1));
    expect(plan.status).toBe('blocked');
    expect(statuses(plan)).toEqual({
      PROPOSAL: 'locked',
      NOM: 'locked',
      OTHER_PRE_EVENT: 'locked',
      ACR: 'locked',
      FINANCIAL_REPORT: 'locked',
    });
    expect(nextDeadline(plan)).toBeNull();
  });

  it('keeps reports locked on the event day while blocked', () => {
    expect(statuses(planProject(facts(), EVENT_DAY))).toMatchObject({
      ACR: 'locked',
      FINANCIAL_REPORT: 'locked',
    });
  });

  it('never blocks once the proposal is submitted, however late', () => {
    expect(planProject(facts({}, ['PROPOSAL']), EVENT_DAY).status).toBe('active');
  });

  it('unblocks when an approved appeal moves the proposal deadline', () => {
    const newDue = new Date('2026-10-25T15:59:59.999Z');
    const plan = planProject(facts({ proposalDueOverride: newDue }), EVENT_DAY);
    expect(plan.status).toBe('active');
    expect(plan.proposalDueAt).toEqual(newDue);
    expect(statuses(plan)).toMatchObject({ PROPOSAL: 'open', ACR: 'open' });
    // And blocks again if that deadline passes too.
    expect(planProject(facts({ proposalDueOverride: newDue }), ms(newDue, 1)).status).toBe(
      'blocked',
    );
  });
});

describe('planProject: post-event deadline (spec 3B)', () => {
  const filedProposal: ProjectTaskType[] = ['PROPOSAL'];

  it('has no overdue reports up to the deadline', () => {
    expect(planProject(facts({}, filedProposal), REPORTS_DUE).overdueReports).toEqual([]);
  });

  it('lists the missing reports once the deadline passes', () => {
    const after = ms(REPORTS_DUE, 1);
    expect(planProject(facts({}, filedProposal), after).overdueReports).toEqual([
      'ACR',
      'FINANCIAL_REPORT',
    ]);
    expect(planProject(facts({}, ['PROPOSAL', 'ACR']), after).overdueReports).toEqual([
      'FINANCIAL_REPORT',
    ]);
    expect(
      planProject(facts({}, ['PROPOSAL', 'ACR', 'FINANCIAL_REPORT']), after).overdueReports,
    ).toEqual([]);
  });

  it('does not count reports of a blocked project, which could not file them', () => {
    const plan = planProject(facts(), ms(REPORTS_DUE, 1));
    expect(plan.status).toBe('blocked');
    expect(plan.overdueReports).toEqual([]);
  });

  it('never blocks or freezes the ISSC, whose appeals nobody decides', () => {
    const issc = (filed: ProjectTaskType[] = []) => facts({ exemptFromCompliance: true }, filed);
    const late = planProject(issc(), ms(REPORTS_DUE, 1));
    expect(late.status).toBe('active');
    expect(late.overdueReports).toEqual([]);
    expect(planProject(issc(['PROPOSAL']), ms(REPORTS_DUE, 1)).overdueReports).toEqual([]);
    // Deadlines still show.
    expect(late.proposalDueAt).toEqual(PROPOSAL_DUE);
  });

  it('uses the deadline an approved appeal set', () => {
    const newDue = new Date('2026-11-20T15:59:59.999Z');
    const moved = facts({ postEventDueOverride: newDue }, filedProposal);
    expect(planProject(moved, ms(REPORTS_DUE, 1)).overdueReports).toEqual([]);
    expect(planProject(moved, ms(newDue, 1)).overdueReports).toEqual(['ACR', 'FINANCIAL_REPORT']);
  });
});

describe('deadlinesSoon', () => {
  it('lists open tasks due within 3 Manila calendar days', () => {
    // Oct 12, 09:00 Manila: 3 days before the Oct 15 deadline.
    expect(
      deadlinesSoon(
        planProject(facts(), new Date('2026-10-12T01:00:00Z')),
        new Date('2026-10-12T01:00:00Z'),
      ),
    ).toEqual([{ type: 'PROPOSAL', dueAt: PROPOSAL_DUE }]);
  });

  it('is empty 4 days before, after the deadline, and for submitted tasks', () => {
    const fourBefore = new Date('2026-10-11T01:00:00Z');
    expect(deadlinesSoon(planProject(facts(), fourBefore), fourBefore)).toEqual([]);
    const late = ms(PROPOSAL_DUE, 1);
    expect(deadlinesSoon(planProject(facts(), late), late)).toEqual([]);
    const at = new Date('2026-10-13T01:00:00Z');
    expect(deadlinesSoon(planProject(facts({}, ['PROPOSAL']), at), at)).toEqual([]);
  });
});

describe('deadlinesAfterApproval', () => {
  const newDue = new Date('2026-11-10T15:59:59.999Z');

  it('a freeze appeal moves the post-event deadline', () => {
    expect(deadlinesAfterApproval('ORG_FREEZE', { postEventDueAt: REPORTS_DUE }, newDue)).toEqual({
      postEventDueOverride: newDue,
    });
  });

  it('a block appeal moves the proposal deadline, and the reports when they would come first', () => {
    expect(
      deadlinesAfterApproval('PROJECT_BLOCK', { postEventDueAt: REPORTS_DUE }, PROPOSAL_DUE),
    ).toEqual({ proposalDueOverride: PROPOSAL_DUE });
    expect(
      deadlinesAfterApproval('PROJECT_BLOCK', { postEventDueAt: REPORTS_DUE }, newDue),
    ).toEqual({ proposalDueOverride: newDue, postEventDueOverride: newDue });
  });
});

describe('nextDeadline', () => {
  it('is the earliest due date among open tasks', () => {
    expect(nextDeadline(planProject(facts(), CREATED))).toEqual({
      type: 'PROPOSAL',
      dueAt: PROPOSAL_DUE,
    });
    expect(nextDeadline(planProject(facts({}, ['PROPOSAL']), EVENT_DAY))).toEqual({
      type: 'ACR',
      dueAt: REPORTS_DUE,
    });
  });

  it('is null when nothing open has a deadline', () => {
    const plan = planProject(facts({ nomRequired: true }, ['PROPOSAL']), BEFORE_EVENT);
    expect(nextDeadline(plan)).toBeNull();
  });
});
