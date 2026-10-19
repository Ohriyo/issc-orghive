import { beforeEach, describe, expect, it } from 'vitest';
import { createCollegeRepository } from '#src/repositories/college.repository';
import { createAccountRepository } from '#src/repositories/account.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { buildWorld, resetDb, testDb, type World } from '../db';

const db = testDb();
const organizations = createOrganizationRepository(db);
const colleges = createCollegeRepository(db);
const accounts = createAccountRepository(db);
let world: World;

beforeEach(async () => {
  await resetDb(db);
  world = await buildWorld(db);
});

describe('organizationRepository', () => {
  it('finds by slug with its college', async () => {
    const jpice = await organizations.findBySlug('jpice');
    expect(jpice).toMatchObject({ type: 'SBO', acronym: 'JPICE', college: { code: 'CEA' } });
  });

  it('lists the children of a CSC and leaves out deleted ones', async () => {
    await db.organization.update({
      where: { id: world.orgs.psme.id },
      data: { deletedAt: new Date() },
    });
    const children = await organizations.listChildren(world.orgs.cscCea.id);
    expect(children.map((o) => o.slug)).toEqual(['jpice']);
    expect(await organizations.findBySlug('psme')).toBeNull();
  });

  it('lists ids by type and parent', async () => {
    expect((await organizations.listIds({ type: 'CSC' })).sort()).toEqual(
      [world.orgs.cscCea.id, world.orgs.cscCat.id].sort(),
    );
    expect(
      (await organizations.listIds({ type: 'SBO', parentIds: [world.orgs.cscCea.id] })).sort(),
    ).toEqual([world.orgs.jpice.id, world.orgs.psme.id].sort());
  });
});

describe('collegeRepository', () => {
  it('lists colleges with their CSC', async () => {
    const list = await colleges.list();
    const cea = list.find((c) => c.code === 'CEA');
    expect(cea?.organizations.map((o) => o.acronym)).toEqual(['CSC-CEA']);
  });
});

describe('accountRepository (shared organization accounts)', () => {
  it('finds the organization an active account acts for', async () => {
    expect(await accounts.findAccount(world.users.governor.id)).toMatchObject({
      userId: world.users.governor.id,
      organization: { id: world.orgs.cscCea.id, type: 'CSC', parentId: world.orgs.issc.id },
    });
  });

  it('gives a locked or deactivated account, or one without an organization, nothing', async () => {
    expect(await accounts.findAccount(world.users.outsider.id)).toBeNull();
    await db.user.update({
      where: { id: world.users.governor.id },
      data: { lockedAt: new Date() },
    });
    expect(await accounts.findAccount(world.users.governor.id)).toBeNull();
    expect(await accounts.findOrganizationAccount(world.orgs.cscCea.id)).toBeNull();
    await db.user.update({
      where: { id: world.users.officer.id },
      data: { disabledAt: new Date() },
    });
    expect(await accounts.findAccount(world.users.officer.id)).toBeNull();
  });

  it('allows one active account per organization; a deactivated one frees the slot', async () => {
    const second = () =>
      db.user.create({
        data: {
          email: 'jpice2@test.local',
          name: 'x',
          passwordHash: 'x',
          organizationId: world.orgs.jpice.id,
        },
      });
    await expect(second()).rejects.toThrow();
    await db.user.update({
      where: { id: world.users.officer.id },
      data: { disabledAt: new Date() },
    });
    await expect(second()).resolves.toMatchObject({ organizationId: world.orgs.jpice.id });
  });

  it('finds the organization account and the accounts under a council', async () => {
    expect(await accounts.findOrganizationAccount(world.orgs.jpice.id)).toMatchObject({
      id: world.users.officer.id,
    });
    expect(
      (await accounts.findAccountIdsUnder({ councilId: world.orgs.cscCea.id })).sort(),
    ).toEqual([world.users.governor.id, world.users.officer.id, world.users.psme.id].sort());
    const everyone = await accounts.findAccountIdsUnder('everyone');
    expect(everyone).toHaveLength(5);
    expect(everyone).not.toContain(world.users.outsider.id);
  });

  it('reads the open officer term and the terms ending in a window', async () => {
    expect(await accounts.findCurrentTerm(world.users.officer.id)).toMatchObject({
      officerName: 'jpice officer',
      officerPosition: 'President',
    });
    const ending = await accounts.findTermsEndingBetween(
      new Date('2027-07-20'),
      new Date('2027-07-31'),
    );
    expect(ending).toHaveLength(5);
    expect(
      await accounts.findTermsEndingBetween(new Date('2027-08-01'), new Date('2027-08-31')),
    ).toEqual([]);
    await db.officerTerm.updateMany({
      where: { userId: world.users.officer.id },
      data: { endedAt: new Date() },
    });
    expect(await accounts.findCurrentTerm(world.users.officer.id)).toBeNull();
  });
});
