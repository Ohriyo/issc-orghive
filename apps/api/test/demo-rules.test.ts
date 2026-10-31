import { describe, expect, it } from 'vitest';
import { manilaDate, semesterRange } from '@orghive/shared';
import { appealDeciderOf } from '#src/services/appeal-rules';
import {
  demoDataGuard,
  demoOverrides,
  planDemoData,
  planDemoProject,
  type DemoPlan,
} from '#src/services/demo-rules';
import { rankStandings, type OrganizationStandingFacts } from '#src/services/leaderboard-rules';

const NOW = new Date('2026-10-21T04:00:00Z');
const plan = planDemoData(NOW);
const project = (key: string) => plan.projects.find((p) => p.key === key)!;

/** The parent of every organization the plan uses, as the seed makes them. */
const PARENT: Record<string, string | null> = {
  issc: null,
  'csc-ccis': 'issc',
  'csc-cea': 'issc',
  'csc-com': 'issc',
  'csc-coed': 'issc',
  'csc-cat': 'issc',
  asit: 'csc-ccis',
  tag: 'csc-ccis',
  iso: 'csc-ccis',
  jpice: 'csc-cea',
  iecep: 'csc-cea',
  uapsa: 'csc-cea',
  psme: 'csc-cea',
  jiiee: 'csc-cea',
};
const typeOf = (slug: string) =>
  slug === 'issc' ? 'ISSC' : slug.startsWith('csc-') ? 'CSC' : 'SBO';

/** The plan as the ranking reads it, as of `at` (only what was submitted by then). */
function facts(p: DemoPlan, at: Date): OrganizationStandingFacts[] {
  return p.organizations.map((slug) => ({
    organizationId: slug,
    type: typeOf(slug),
    name: slug,
    projects: p.projects
      .filter((x) => x.org === slug)
      .map((x) => ({
        createdAt: x.createdAt,
        targetDate: x.targetDate,
        nomRequired: x.nomRequired,
        momRequired: false,
        communicationLetterRequired: x.communicationLetterRequired,
        attendanceSheetRequired: false,
        submitted: Object.fromEntries(Object.entries(x.submitted).filter(([, when]) => when <= at)),
        figures: x.figures && { ...x.figures, underReview: false },
      })),
  }));
}

describe('planDemoData: the leaderboard, through the real ranking', () => {
  it.each([0, 0.3, 0.5, 1])(
    'puts ASIT, TAG, ISO first on the SBO board at a late value of %s',
    (latePoints) => {
      const boards = rankStandings(facts(plan, NOW), { latePoints, now: NOW });
      expect(boards.SBO.map((r) => r.organizationId)).toEqual([
        'asit',
        'tag',
        'iso',
        'jpice',
        'iecep',
        'uapsa',
        'psme',
        'jiiee',
      ]);
      expect(boards.SBO.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    },
  );

  it('gives TAG exactly one late project, and the others none', () => {
    const { SBO } = rankStandings(facts(plan, NOW), { latePoints: 0.5, now: NOW });
    const row = (id: string) => SBO.find((r) => r.organizationId === id)!;
    expect(row('tag')).toMatchObject({ implementedCount: 4, lateCount: 1, points: 3.5 });
    expect(row('asit')).toMatchObject({
      implementedCount: 4,
      lateCount: 0,
      netProfitCentavos: 1_850_000,
    });
    expect(row('iso')).toMatchObject({ implementedCount: 3, lateCount: 0 });
  });

  it('ranks five CSCs, and never the ISSC', () => {
    const boards = rankStandings(facts(plan, NOW), { latePoints: 0.5, now: NOW });
    expect(boards.CSC.map((r) => r.organizationId)).toEqual([
      'csc-cea',
      'csc-ccis',
      'csc-com',
      'csc-coed',
      'csc-cat',
    ]);
  });

  it('a week ago the lower rows stood differently, so the arrows go both ways', () => {
    const before = rankStandings(facts(plan, plan.previousStandingsAt), {
      latePoints: 0.5,
      now: plan.previousStandingsAt,
    });
    expect(before.SBO.map((r) => r.organizationId)).toEqual([
      'asit',
      'tag',
      'iso',
      'iecep',
      'jpice',
      'psme',
      'uapsa',
      'jiiee',
    ]);
    expect(before.CSC.map((r) => r.organizationId)).toEqual([
      'csc-cea',
      'csc-ccis',
      'csc-coed',
      'csc-com',
      'csc-cat',
    ]);
  });
});

describe('planDemoData: placed in the current semester', () => {
  it('puts every completed project in the semester, and nothing after now', () => {
    const { start, end } = semesterRange('2026-2027', 'first');
    for (const p of plan.projects.filter((x) => x.figures)) {
      expect(p.targetDate >= start && p.targetDate <= end, p.key).toBe(true);
      expect(p.targetDate <= manilaDate(NOW), p.key).toBe(true);
    }
    for (const p of plan.projects) {
      expect(p.createdAt <= NOW, p.key).toBe(true);
      for (const when of Object.values(p.submitted)) expect(when <= NOW, p.key).toBe(true);
    }
  });

  it('on a semester’s first days, still ranks the Top 3 from that semester', () => {
    const early = new Date('2027-01-02T04:00:00Z');
    const p = planDemoData(early);
    for (const x of p.projects.filter((y) => y.figures)) {
      expect(x.targetDate >= '2027-01-01', x.key).toBe(true);
    }
    const { SBO } = rankStandings(facts(p, early), { latePoints: 0.5, now: early });
    expect(SBO.slice(0, 3).map((r) => r.organizationId)).toEqual(['asit', 'tag', 'iso']);
  });
});

describe('planDemoData: blocks, freezes and appeals follow the real rules', () => {
  const overrides = demoOverrides(plan);
  const planned = (key: string, withOverrides = true) =>
    planDemoProject(project(key), withOverrides ? overrides.get(key) : undefined, false, NOW);

  it('blocks the two projects whose proposals were never filed', () => {
    expect(planned('asit-blocked').status).toBe('blocked');
    expect(planned('tag-blocked').status).toBe('blocked');
  });

  it('freezes exactly for the reports each freeze lists', () => {
    for (const freeze of plan.freezes) {
      expect(planned(freeze.project, false).overdueReports, freeze.key).toEqual(freeze.reports);
    }
  });

  it('the approved appeal moved ISO’s deadline, so ISO is no longer overdue; CSC-CCIS still is', () => {
    expect(planned('iso-frozen').overdueReports).toEqual([]);
    expect(planned('iso-frozen').postEventDueAt.toISOString()).toBe('2026-10-28T15:59:59.999Z');
    expect(planned('csc-ccis-frozen').overdueReports).toEqual(['FINANCIAL_REPORT']);
    const iso = plan.freezes.find((f) => f.key === 'iso-freeze')!;
    const ccis = plan.freezes.find((f) => f.key === 'csc-ccis-freeze')!;
    expect(iso.liftedAt).not.toBeNull();
    expect(ccis.liftedAt).toBeNull();
  });

  it('the pre-event projects have the proposal in and the NOM and Communication Letter open', () => {
    for (const key of ['asit-pre', 'tag-pre', 'iso-pre']) {
      const tasks = new Map(planned(key).tasks.map((t) => [t.type, t.status]));
      expect(tasks.get('PROPOSAL')).toBe('submitted');
      expect(tasks.get('NOM')).toBe('open');
      expect(tasks.get('COMMUNICATION_LETTER')).toBe('open');
      expect(tasks.get('ACR')).toBe('locked');
    }
    expect(planned('asit-next').status).toBe('active');
    expect(planned('asit-1').status).toBe('completed');
  });

  it('routes each appeal to the account appeal-rules.ts picks', () => {
    const expected = {
      'asit-appeal': ['PROJECT_BLOCK', 'pending', 'csc-ccis'],
      'iso-appeal': ['ORG_FREEZE', 'approved', 'csc-ccis'],
      'tag-appeal': ['PROJECT_BLOCK', 'rejected', 'csc-ccis'],
      'csc-ccis-appeal': ['ORG_FREEZE', 'pending', 'issc'],
    };
    expect(
      Object.fromEntries(plan.appeals.map((a) => [a.key, [a.type, a.status, a.decider]])),
    ).toEqual(expected);
    for (const a of plan.appeals) {
      const org = project(a.project).org;
      expect(
        appealDeciderOf({ id: org, type: typeOf(org), parentId: PARENT[org]! })?.organizationId,
        a.key,
      ).toBe(a.decider);
    }
    const decided = plan.appeals.filter((a) => a.status !== 'pending');
    for (const a of decided) expect(a.remarks, a.key).toBeTruthy();
    expect(plan.appeals.find((a) => a.key === 'iso-appeal')!.newDueDate).toBe('2026-10-28');
  });

  it('has the ISSC’s three announcements and one from CSC-CCIS', () => {
    expect(plan.announcements.map((a) => a.org).sort()).toEqual([
      'csc-ccis',
      'issc',
      'issc',
      'issc',
    ]);
  });
});

describe('demoDataGuard', () => {
  it('only production with demo rows refuses, unless explicitly allowed', () => {
    expect(demoDataGuard({ nodeEnv: 'development', allowDemoData: false, demoRows: 5 })).toBe('ok');
    expect(demoDataGuard({ nodeEnv: 'test', allowDemoData: false, demoRows: 5 })).toBe('ok');
    expect(demoDataGuard({ nodeEnv: 'production', allowDemoData: false, demoRows: 0 })).toBe('ok');
    expect(demoDataGuard({ nodeEnv: 'production', allowDemoData: false, demoRows: 1 })).toBe(
      'refuse',
    );
    expect(demoDataGuard({ nodeEnv: 'production', allowDemoData: true, demoRows: 1 })).toBe(
      'allowed',
    );
  });
});
