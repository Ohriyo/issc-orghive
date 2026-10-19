import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ComplianceOverview, ComplianceRow } from '@orghive/shared';
import { createComplianceOverviewRepository } from '#src/repositories/compliance-overview.repository';
import { createAccountRepository } from '#src/repositories/account.repository';
import { createComplianceOverviewService } from '#src/services/compliance-overview.service';
import { createTokenService } from '#src/services/token.service';
import { testKeys } from './auth-fixtures';
import { buildComplianceWorld, seedProject, type Person } from './compliance-fixtures';
import { testDb } from './db';
import { buildTestApp } from './helpers';

const db = testDb();
const tokens = createTokenService(testKeys());
/** 08:00 on October 16, 2026, Manila: the 1st semester of 2026-2027. */
const NOW = new Date('2026-10-16T00:00:00Z');

let app: ReturnType<typeof buildTestApp>;
let ids: Record<Person, string>;
let projectIds: Record<'blocked' | 'active' | 'psme' | 'nextSemester', string>;

async function tokenFor(userId: string) {
  const { token } = await tokens.sign({
    userId,
    passwordChangeRequired: false,
  });
  return token;
}

async function overview(person: Person, query = '') {
  return request(app)
    .get(`/api/v1/compliance/overview${query}`)
    .set('Authorization', `Bearer ${await tokenFor(ids[person])}`);
}

const rowOf = (body: ComplianceOverview, slug: string): ComplianceRow =>
  body.organizations.find((r) => r.organization.slug === slug)!;

beforeAll(async () => {
  const built = await buildComplianceWorld(db);
  ids = built.ids;
  const { orgs } = built;
  const at = (iso: string) => new Date(iso);
  const blocked = await seedProject(db, {
    organizationId: orgs.jpice.id,
    createdById: ids.officer,
    createdAt: at('2026-09-20T02:00:00Z'), // proposal due October 4: blocked
    targetDate: '2026-10-30',
    name: 'Bridge design competition',
  });
  const active = await seedProject(db, {
    organizationId: orgs.jpice.id,
    createdById: ids.officer,
    createdAt: at('2026-10-10T02:00:00Z'), // proposal due October 24
    targetDate: '2026-11-20',
    name: 'Site visit',
  });
  const psme = await seedProject(db, {
    organizationId: orgs.psme.id,
    createdById: ids.psmeOfficer,
    createdAt: at('2026-10-12T02:00:00Z'), // proposal due October 26
    targetDate: '2026-11-05',
    name: 'Plant visit',
  });
  const nextSemester = await seedProject(db, {
    organizationId: orgs.jpice.id,
    createdById: ids.officer,
    createdAt: at('2026-10-12T02:00:00Z'),
    targetDate: '2027-02-10',
    name: 'CE week',
  });
  projectIds = {
    blocked: blocked.id,
    active: active.id,
    psme: psme.id,
    nextSemester: nextSemester.id,
  };
  await db.orgFreeze.create({
    data: {
      organizationId: orgs.psme.id,
      projectId: psme.id,
      reports: ['ACR'],
      frozenAt: at('2026-10-02T00:00:00Z'),
    },
  });
  await db.appeal.create({
    data: {
      type: 'PROJECT_BLOCK',
      organizationId: orgs.jpice.id,
      projectId: blocked.id,
      reason: 'The adviser was on leave when the proposal was due.',
      submittedById: ids.officer,
    },
  });

  const accounts = createAccountRepository(db);
  app = buildTestApp({
    tokens,
    complianceOverview: createComplianceOverviewService({
      overview: createComplianceOverviewRepository(db),
      accounts,
      now: () => NOW,
    }),
  });
});

describe('GET /compliance/overview access', () => {
  it('401s signed out', async () => {
    await request(app).get('/api/v1/compliance/overview').expect(401);
  });

  it.each<Person>(['officer', 'psmeOfficer', 'catSboOfficer', 'outsider'])(
    '403s an SBO account or one acting for no organization (%s)',
    async (person) => {
      expect((await overview(person)).status).toBe(403);
    },
  );

  it('400s a semester without its academic year', async () => {
    expect((await overview('governor', '?semester=first')).status).toBe(400);
  });

  it('is never cached', async () => {
    const res = await overview('governor');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });
});

describe('GET /compliance/overview scope', () => {
  it('shows a CSC account its college’s SBOs only', async () => {
    const body = (await overview('governor')).body as ComplianceOverview;
    expect(body.scope).toEqual({ type: 'CSC', acronym: 'CSC-CEA' });
    expect(body.organizations.map((r) => r.organization.slug).sort()).toEqual(['jpice', 'psme']);
  });

  it.each<Person>(['isscPresident', 'admin'])(
    'shows the ISSC account (%s) every CSC and SBO',
    async (person) => {
      const body = (await overview(person)).body as ComplianceOverview;
      expect(body.scope.type).toBe('ISSC');
      expect(body.organizations.map((r) => r.organization.slug).sort()).toEqual([
        'cat-sbo',
        'csc-cat',
        'csc-cea',
        'jpice',
        'psme',
      ]);
    },
  );
});

describe('GET /compliance/overview figures', () => {
  it('defaults to the current semester and reads the project rules', async () => {
    const body = (await overview('governor')).body as ComplianceOverview;
    expect(body).toMatchObject({ academicYear: '2026-2027', semester: 'first' });
    expect(rowOf(body, 'jpice')).toMatchObject({
      organization: { acronym: 'JPICE', college: 'CEA' },
      activeProjects: 1,
      blockedProjects: [{ id: projectIds.blocked, name: 'Bridge design competition' }],
      nextDeadline: { projectId: projectIds.active, task: 'PROPOSAL' },
      overdueTasks: [{ projectId: projectIds.blocked, task: 'PROPOSAL', daysOverdue: 12 }],
      frozenSince: null,
      openAppeals: 1,
    });
    expect(rowOf(body, 'psme')).toMatchObject({
      activeProjects: 1,
      overdueTasks: [],
      frozenSince: '2026-10-02T00:00:00.000Z',
      openAppeals: 0,
    });
  });

  it('counts projects by the semester of their target date; freezes show regardless', async () => {
    const body = (await overview('governor', '?academicYear=2026-2027&semester=second'))
      .body as ComplianceOverview;
    expect(rowOf(body, 'jpice')).toMatchObject({
      activeProjects: 1,
      blockedProjects: [],
      nextDeadline: { projectId: projectIds.nextSemester },
      overdueTasks: [],
      openAppeals: 1,
    });
    expect(rowOf(body, 'psme')).toMatchObject({
      activeProjects: 0,
      frozenSince: '2026-10-02T00:00:00.000Z',
    });
  });
});
