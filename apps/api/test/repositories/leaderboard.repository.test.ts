import { beforeEach, describe, expect, it } from 'vitest';
import { createFinancialFiguresRepository } from '#src/repositories/financial-figures.repository';
import { createLeaderboardRepository } from '#src/repositories/leaderboard.repository';
import { createSystemSettingRepository } from '#src/repositories/system-setting.repository';
import { buildWorld, resetDb, testDb, type World } from '../db';

const db = testDb();
const leaderboard = createLeaderboardRepository(db);
const figures = createFinancialFiguresRepository(db);
const settings = createSystemSettingRepository(db);
const FIRST = { start: '2026-08-01', end: '2026-12-31' };
let world: World;

beforeEach(async () => {
  await resetDb(db);
  world = await buildWorld(db);
});

async function project(organizationId: string, targetDate: string, deleted = false) {
  return db.project.create({
    data: {
      organizationId,
      name: `Project ${targetDate}`,
      targetDate: new Date(`${targetDate}T00:00:00Z`),
      location: 'CEA',
      beneficiaries: 'Students',
      description: 'x',
      proposalDueAt: new Date(),
      postEventDueAt: new Date(),
      createdById: world.users.officer.id,
      deletedAt: deleted ? new Date() : null,
    },
  });
}

describe('leaderboardRepository.standingFacts', () => {
  it('reads SBOs and CSCs only, without deactivated or deleted organizations', async () => {
    await db.organization.update({
      where: { id: world.orgs.psme.id },
      data: { deactivatedAt: new Date() },
    });
    await db.organization.update({
      where: { id: world.orgs.cscCat.id },
      data: { deletedAt: new Date() },
    });
    const rows = await leaderboard.standingFacts(FIRST);
    expect(rows.map((r) => r.id).sort()).toEqual(
      [world.orgs.jpice.id, world.orgs.cscCea.id].sort(),
    );
  });

  it('reads the semester’s undeleted projects with their submitted tasks and figures', async () => {
    const inside = await project(world.orgs.jpice.id, '2026-12-31');
    await project(world.orgs.jpice.id, '2027-01-01');
    await project(world.orgs.jpice.id, '2026-10-20', true);
    await db.projectTask.createMany({
      data: [
        { projectId: inside.id, type: 'ACR', status: 'submitted', submittedAt: new Date() },
        { projectId: inside.id, type: 'FINANCIAL_REPORT', status: 'open' },
      ],
    });
    await figures.save(inside.id, { incomeCentavos: 10, expensesCentavos: 3 });

    const jpice = (await leaderboard.standingFacts(FIRST)).find(
      (r) => r.id === world.orgs.jpice.id,
    )!;
    expect(jpice).toMatchObject({ type: 'SBO', name: world.orgs.jpice.name });
    expect(jpice.projects).toHaveLength(1);
    expect(jpice.projects[0]!.tasks.map((t) => t.type)).toEqual(['ACR']);
    expect(jpice.projects[0]!.figures).toEqual({
      incomeCentavos: 10,
      expensesCentavos: 3,
      flaggedAt: null,
    });
  });
});

describe('leaderboardRepository snapshots', () => {
  const key = { academicYear: '2026-2027', semester: 'first' as const, type: 'SBO' as const };

  it('returns the latest snapshot of the board', async () => {
    expect(await leaderboard.latestSnapshot(key)).toBeNull();
    await leaderboard.saveSnapshot(key, [{ organizationId: 'a' }], new Date('2026-11-01'));
    await leaderboard.saveSnapshot(key, [{ organizationId: 'b' }], new Date('2026-11-02'));
    await leaderboard.saveSnapshot({ ...key, type: 'CSC' }, [], new Date('2026-11-03'));
    expect(await leaderboard.latestSnapshot(key)).toEqual({
      rows: [{ organizationId: 'b' }],
      computedAt: new Date('2026-11-02'),
    });
  });
});

describe('financialFiguresRepository', () => {
  it('returns what a save replaced', async () => {
    const p = await project(world.orgs.jpice.id, '2026-10-20');
    const first = await figures.save(p.id, { incomeCentavos: 100, expensesCentavos: 40 });
    expect(first.before).toBeNull();
    expect(first.after).toMatchObject({ incomeCentavos: 100, expensesCentavos: 40 });
    const second = await figures.save(p.id, { incomeCentavos: 90, expensesCentavos: 40 });
    expect(second.before).toMatchObject({ incomeCentavos: 100 });
    expect(second.after).toMatchObject({ incomeCentavos: 90 });
  });

  it('flags and clears once, and refuses amounts out of range', async () => {
    const p = await project(world.orgs.jpice.id, '2026-10-20');
    expect(
      await figures.flag(p.id, { remark: 'x', flaggedById: world.users.issc.id, at: new Date() }),
    ).toBeNull();
    await figures.save(p.id, { incomeCentavos: 1, expensesCentavos: 1 });
    const flagged = await figures.flag(p.id, {
      remark: 'Check',
      flaggedById: world.users.issc.id,
      at: new Date('2026-11-01T00:00:00Z'),
    });
    expect(flagged).toMatchObject({ flagRemark: 'Check' });
    expect(await figures.clearFlag(p.id)).toBe(true);
    expect(await figures.clearFlag(p.id)).toBe(false);
    await expect(figures.save(p.id, { incomeCentavos: -1, expensesCentavos: 0 })).rejects.toThrow();
  });
});

describe('systemSettingRepository', () => {
  it('stores and replaces a value', async () => {
    expect(await settings.get('leaderboard.latePoints')).toBeNull();
    await settings.set('leaderboard.latePoints', 0.25, world.users.officer.id);
    await settings.set('leaderboard.latePoints', 0.75, world.users.officer.id);
    expect(await settings.get('leaderboard.latePoints')).toMatchObject({ value: 0.75 });
  });
});
