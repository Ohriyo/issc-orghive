import { describe, expect, it } from 'vitest';
import {
  figuresCorrectableUntil,
  rankStandings,
  scoreProject,
  type OrganizationStandingFacts,
  type ProjectStandingFacts,
  type RankingOptions,
} from '#src/services/leaderboard-rules';

// Created Oct 1, 10:00 Manila; event on Oct 20. Proposal due Oct 15, reports due Nov 3.
const CREATED = new Date('2026-10-01T02:00:00Z');
const PROPOSAL_ON_TIME = new Date('2026-10-10T02:00:00Z');
/** Oct 16, 00:30 Manila: one day after the proposal deadline. */
const PROPOSAL_LATE = new Date('2026-10-15T16:30:00Z');
const REPORT_ON_TIME = new Date('2026-10-25T02:00:00Z');
/** Nov 3, 23:59:59.999 Manila: the last instant that is still on time. */
const REPORTS_DUE = new Date('2026-11-03T15:59:59.999Z');
/** Nov 4, 00:00 Manila. */
const REPORT_LATE = new Date('2026-11-03T16:00:00Z');
const NOW = new Date('2026-12-01T02:00:00Z');
const OPTIONS: RankingOptions = { latePoints: 0.5, now: NOW };

/** An on-time implemented project with ₱1,000.00 profit, unless overridden. */
function project(overrides: Partial<ProjectStandingFacts> = {}): ProjectStandingFacts {
  return {
    createdAt: CREATED,
    targetDate: '2026-10-20',
    nomRequired: false,
    momRequired: false,
    submitted: {
      PROPOSAL: PROPOSAL_ON_TIME,
      ACR: REPORT_ON_TIME,
      FINANCIAL_REPORT: REPORT_ON_TIME,
    },
    figures: { incomeCentavos: 500_000, expensesCentavos: 400_000, underReview: false },
    ...overrides,
  };
}

const late = (overrides: Partial<ProjectStandingFacts> = {}) =>
  project({
    submitted: { PROPOSAL: PROPOSAL_ON_TIME, ACR: REPORT_LATE, FINANCIAL_REPORT: REPORT_ON_TIME },
    ...overrides,
  });

function org(
  name: string,
  projects: ProjectStandingFacts[],
  type: OrganizationStandingFacts['type'] = 'SBO',
): OrganizationStandingFacts {
  return { organizationId: `id-${name}`, type, name, projects };
}

const sbo = (orgs: OrganizationStandingFacts[], options = OPTIONS) =>
  rankStandings(orgs, options).SBO;

describe('scoreProject: implemented', () => {
  it('counts a project whose event passed and whose ACR and Financial Report are in', () => {
    expect(scoreProject(project(), OPTIONS)).toEqual({
      implemented: true,
      late: false,
      points: 100,
      completedAt: REPORT_ON_TIME,
      netCentavos: 100_000,
      underReview: false,
    });
  });

  it('does not count a project missing its ACR, but still adds its profit', () => {
    const score = scoreProject(
      project({ submitted: { PROPOSAL: PROPOSAL_ON_TIME, FINANCIAL_REPORT: REPORT_ON_TIME } }),
      OPTIONS,
    );
    expect(score).toMatchObject({ implemented: false, points: 0, netCentavos: 100_000 });
  });

  it('does not count a project missing its Financial Report, and adds no profit', () => {
    const score = scoreProject(
      project({ submitted: { PROPOSAL: PROPOSAL_ON_TIME, ACR: REPORT_ON_TIME } }),
      OPTIONS,
    );
    expect(score).toMatchObject({ implemented: false, netCentavos: null, completedAt: null });
  });

  it('waits for the event day in Manila', () => {
    const eve = new Date('2026-10-19T15:30:00Z'); // Oct 19, 23:30 Manila
    const day = new Date('2026-10-19T16:30:00Z'); // Oct 20, 00:30 Manila
    const early = project({ submitted: { ACR: eve, FINANCIAL_REPORT: eve, PROPOSAL: eve } });
    expect(scoreProject(early, { ...OPTIONS, now: eve }).implemented).toBe(false);
    expect(scoreProject(early, { ...OPTIONS, now: day }).implemented).toBe(true);
  });

  it('completes on the later of the two reports', () => {
    const score = scoreProject(
      project({
        submitted: {
          PROPOSAL: PROPOSAL_ON_TIME,
          ACR: REPORTS_DUE,
          FINANCIAL_REPORT: REPORT_ON_TIME,
        },
      }),
      OPTIONS,
    );
    expect(score.completedAt).toEqual(REPORTS_DUE);
  });
});

describe('scoreProject: late', () => {
  it('is on time up to 23:59:59 Manila on day 14', () => {
    const score = scoreProject(
      project({
        submitted: { PROPOSAL: PROPOSAL_ON_TIME, ACR: REPORTS_DUE, FINANCIAL_REPORT: REPORTS_DUE },
      }),
      OPTIONS,
    );
    expect(score).toMatchObject({ late: false, points: 100 });
  });

  it.each([
    ['the proposal', { PROPOSAL: PROPOSAL_LATE }],
    ['the ACR', { ACR: REPORT_LATE }],
    ['the Financial Report', { FINANCIAL_REPORT: REPORT_LATE }],
  ])('earns the late value when %s was late', (_label, lateTask) => {
    const score = scoreProject(
      project({ submitted: { ...project().submitted, ...lateTask } }),
      OPTIONS,
    );
    expect(score).toMatchObject({ implemented: true, late: true, points: 50 });
  });

  it('is late when the proposal deadline passed with no proposal', () => {
    const score = scoreProject(
      project({ submitted: { ACR: REPORT_ON_TIME, FINANCIAL_REPORT: REPORT_ON_TIME } }),
      OPTIONS,
    );
    expect(score).toMatchObject({ implemented: true, late: true });
  });

  it('is not late while the proposal is missing but not yet due', () => {
    // Created Oct 15, event Oct 16: reports in Oct 17, proposal due Oct 29.
    const now = new Date('2026-10-18T02:00:00Z');
    const score = scoreProject(
      project({
        createdAt: new Date('2026-10-15T02:00:00Z'),
        targetDate: '2026-10-16',
        submitted: { ACR: now, FINANCIAL_REPORT: now },
      }),
      { ...OPTIONS, now },
    );
    expect(score).toMatchObject({ implemented: true, late: false, points: 100 });
  });

  it('never counts NOM or MOM as late: they have no deadline', () => {
    const score = scoreProject(
      project({
        nomRequired: true,
        momRequired: true,
        submitted: { ...project().submitted, NOM: REPORT_LATE, MOM: NOW },
      }),
      OPTIONS,
    );
    expect(score).toMatchObject({ late: false, points: 100 });
  });

  it('is still late when an approved appeal set a new deadline', () => {
    // The facts carry no override at all: an appeal's deadline never makes a task on time.
    const score = scoreProject(late(), OPTIONS);
    expect(score).toMatchObject({ late: true, points: 50 });
  });

  it('uses the late value from the setting', () => {
    expect(scoreProject(late(), { ...OPTIONS, latePoints: 0 }).points).toBe(0);
    expect(scoreProject(late(), { ...OPTIONS, latePoints: 0.75 }).points).toBe(75);
    expect(scoreProject(late(), { ...OPTIONS, latePoints: 1 }).points).toBe(100);
  });

  it('adds a late project’s full profit', () => {
    expect(scoreProject(late(), OPTIONS).netCentavos).toBe(100_000);
  });

  it('is not marked late when the project is not implemented', () => {
    const score = scoreProject(
      project({ submitted: { PROPOSAL: PROPOSAL_LATE, FINANCIAL_REPORT: REPORT_ON_TIME } }),
      OPTIONS,
    );
    expect(score).toMatchObject({ implemented: false, late: false, points: 0 });
  });
});

describe('scoreProject: figures', () => {
  it('allows a loss', () => {
    const score = scoreProject(
      project({ figures: { incomeCentavos: 0, expensesCentavos: 250_050, underReview: false } }),
      OPTIONS,
    );
    expect(score.netCentavos).toBe(-250_050);
  });

  it('leaves flagged figures out but keeps the points', () => {
    const score = scoreProject(
      project({ figures: { incomeCentavos: 900_000, expensesCentavos: 0, underReview: true } }),
      OPTIONS,
    );
    expect(score).toMatchObject({ netCentavos: null, underReview: true, points: 100 });
  });

  it('ignores figures until the Financial Report is submitted', () => {
    const score = scoreProject(
      project({ submitted: { PROPOSAL: PROPOSAL_ON_TIME, ACR: REPORT_ON_TIME } }),
      OPTIONS,
    );
    expect(score).toMatchObject({ netCentavos: null, underReview: false });
  });

  it('adds nothing for a submitted Financial Report without figures', () => {
    expect(scoreProject(project({ figures: null }), OPTIONS).netCentavos).toBeNull();
  });
});

describe('rankStandings: points', () => {
  it('totals all on-time projects', () => {
    const [row] = sbo([org('JPICE', [project(), project(), project()])]);
    expect(row).toMatchObject({ points: 3, implementedCount: 3, lateCount: 0 });
  });

  it('totals all late projects', () => {
    const [row] = sbo([org('JPICE', [late(), late()])]);
    expect(row).toMatchObject({ points: 1, implementedCount: 2, lateCount: 2 });
  });

  it('totals a mix: 4.5 pts · 5 projects (1 late)', () => {
    const [row] = sbo([org('JPICE', [project(), project(), project(), project(), late()])]);
    expect(row).toMatchObject({ points: 4.5, implementedCount: 5, lateCount: 1 });
  });

  it('does not rank an organization with zero implemented projects', () => {
    const none = org('IECEP', []);
    const unfinished = org('PSME', [
      project({ submitted: { PROPOSAL: PROPOSAL_ON_TIME, FINANCIAL_REPORT: REPORT_ON_TIME } }),
    ]);
    expect(sbo([none, unfinished])).toEqual([]);
  });

  it('adds a late value like 0.3 exactly', () => {
    const [row] = sbo([org('JPICE', [late(), late(), late()])], { ...OPTIONS, latePoints: 0.3 });
    expect(row!.points).toBe(0.9);
  });

  it('ranks more points first, whatever the profit', () => {
    const rich = org('IECEP', [
      project({ figures: { incomeCentavos: 99_000_000, expensesCentavos: 0, underReview: false } }),
    ]);
    const busy = org('JPICE', [project(), project()]);
    expect(sbo([rich, busy]).map((r) => [r.organizationId, r.rank])).toEqual([
      ['id-JPICE', 1],
      ['id-IECEP', 2],
    ]);
  });
});

describe('rankStandings: profit and ties', () => {
  const profit = (incomeCentavos: number, expensesCentavos = 0) =>
    project({ figures: { incomeCentavos, expensesCentavos, underReview: false } });

  it('breaks a points tie by total net profit', () => {
    const rows = sbo([org('A', [profit(100)]), org('B', [profit(900)])]);
    expect(rows.map((r) => r.organizationId)).toEqual(['id-B', 'id-A']);
    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
  });

  it('sums every submitted Financial Report, including projects without an ACR', () => {
    const [row] = sbo([
      org('A', [
        profit(100_000, 40_000),
        project({
          submitted: { PROPOSAL: PROPOSAL_ON_TIME, FINANCIAL_REPORT: REPORT_ON_TIME },
          figures: { incomeCentavos: 5_000, expensesCentavos: 0, underReview: false },
        }),
      ]),
    ]);
    expect(row).toMatchObject({ netProfitCentavos: 65_000, implementedCount: 1, points: 1 });
  });

  it('ranks a negative total below zero', () => {
    const rows = sbo([org('Loss', [profit(0, 50_000)]), org('Even', [profit(0)])]);
    expect(rows.map((r) => [r.organizationId, r.netProfitCentavos])).toEqual([
      ['id-Even', 0],
      ['id-Loss', -50_000],
    ]);
  });

  it('counts flagged reports and leaves them out of the total', () => {
    const [row] = sbo([
      org('A', [
        profit(100_000),
        project({ figures: { incomeCentavos: 1_000_000, expensesCentavos: 0, underReview: true } }),
      ]),
    ]);
    expect(row).toMatchObject({ netProfitCentavos: 100_000, underReviewCount: 1, points: 2 });
  });

  it('can drop an organization below another once its figures are flagged', () => {
    const flagged = org('A', [
      project({ figures: { incomeCentavos: 1_000_000, expensesCentavos: 0, underReview: true } }),
    ]);
    const rows = sbo([flagged, org('B', [profit(1)])]);
    expect(rows.map((r) => r.organizationId)).toEqual(['id-B', 'id-A']);
  });

  it('breaks a points and profit tie by the earliest last completion', () => {
    const early = org('Z-early', [profit(100)]);
    const later = org('A-later', [
      project({
        submitted: {
          PROPOSAL: PROPOSAL_ON_TIME,
          ACR: REPORTS_DUE,
          FINANCIAL_REPORT: REPORT_ON_TIME,
        },
        figures: { incomeCentavos: 100, expensesCentavos: 0, underReview: false },
      }),
    ]);
    const rows = sbo([later, early]);
    expect(rows.map((r) => [r.organizationId, r.rank])).toEqual([
      ['id-Z-early', 1],
      ['id-A-later', 2],
    ]);
    expect(rows[1]!.lastCompletedAt).toBe(REPORTS_DUE.toISOString());
  });

  it('gives a full tie the same rank, listed by name, and skips the next rank', () => {
    const rows = sbo([
      org('Charlie', [profit(5)]),
      org('Bravo', [profit(5)]),
      org('Alpha', [profit(9)]),
      org('Delta', [profit(1)]),
    ]);
    expect(rows.map((r) => [r.organizationId, r.rank])).toEqual([
      ['id-Alpha', 1],
      ['id-Bravo', 2],
      ['id-Charlie', 2],
      ['id-Delta', 4],
    ]);
  });
});

describe('rankStandings: boards', () => {
  it('ranks SBOs and CSCs separately and never the ISSC', () => {
    const boards = rankStandings(
      [
        org('ISSC', [project(), project(), project()], 'ISSC'),
        org('CEA-CSC', [project()], 'CSC'),
        org('JPICE', [project(), project()], 'SBO'),
      ],
      OPTIONS,
    );
    expect(boards.SBO.map((r) => [r.organizationId, r.rank])).toEqual([['id-JPICE', 1]]);
    expect(boards.CSC.map((r) => [r.organizationId, r.rank])).toEqual([['id-CEA-CSC', 1]]);
  });

  it('returns empty boards for a semester with nothing implemented', () => {
    expect(rankStandings([], OPTIONS)).toEqual({ SBO: [], CSC: [] });
  });

  it('counts reports that arrived after the semester ended', () => {
    // Event Dec 28 (1st semester); reports Jan 5, on time.
    const jan5 = new Date('2027-01-05T02:00:00Z');
    const [row] = sbo(
      [
        org('A', [
          project({
            createdAt: new Date('2026-12-20T02:00:00Z'),
            targetDate: '2026-12-28',
            submitted: {
              PROPOSAL: new Date('2026-12-21T02:00:00Z'),
              ACR: jan5,
              FINANCIAL_REPORT: jan5,
            },
          }),
        ]),
      ],
      { ...OPTIONS, now: new Date('2027-01-06T02:00:00Z') },
    );
    expect(row).toMatchObject({ points: 1, lateCount: 0 });
  });
});

describe('figuresCorrectableUntil', () => {
  it('is the last day of the semester when the reports were due earlier', () => {
    expect(figuresCorrectableUntil('2026-10-20', null)).toEqual(
      new Date('2026-12-31T15:59:59.999Z'),
    );
  });

  it('is the post-event deadline when it falls after the semester', () => {
    // Event Dec 28: reports due Jan 11, after the 1st semester ends on Dec 31.
    expect(figuresCorrectableUntil('2026-12-28', null)).toEqual(
      new Date('2027-01-11T15:59:59.999Z'),
    );
  });

  it('follows a deadline an approved appeal set', () => {
    const moved = new Date('2027-02-15T15:59:59.999Z');
    expect(figuresCorrectableUntil('2026-10-20', moved)).toEqual(moved);
  });

  it('uses each semester’s own end', () => {
    expect(figuresCorrectableUntil('2027-03-01', null)).toEqual(
      new Date('2027-05-31T15:59:59.999Z'),
    );
    expect(figuresCorrectableUntil('2027-06-10', null)).toEqual(
      new Date('2027-07-31T15:59:59.999Z'),
    );
  });
});
