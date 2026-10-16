import { beforeEach, describe, expect, it } from 'vitest';
import { createCollegeRepository } from '#src/repositories/college.repository';
import { createMembershipRepository } from '#src/repositories/membership.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { buildWorld, resetDb, testDb, type World } from '../db';

const db = testDb();
const organizations = createOrganizationRepository(db);
const colleges = createCollegeRepository(db);
const memberships = createMembershipRepository(db);
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

describe('membershipRepository.findActiveForUser', () => {
  it('returns memberships within their term', async () => {
    const active = await memberships.findActiveForUser(
      world.users.governor.id,
      new Date('2026-10-15'),
    );
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      isHead: true,
      title: 'Governor',
      organization: { type: 'CSC' },
    });
  });

  it('grants nothing after term_end or before term_start', async () => {
    expect(
      await memberships.findActiveForUser(world.users.governor.id, new Date('2027-08-01')),
    ).toEqual([]);
    expect(
      await memberships.findActiveForUser(world.users.governor.id, new Date('2026-07-31')),
    ).toEqual([]);
  });

  it('still counts the last day of the term', async () => {
    expect(
      await memberships.findActiveForUser(
        world.users.governor.id,
        new Date('2027-07-31T23:00:00Z'),
      ),
    ).toHaveLength(1);
  });

  it('grants nothing to a disabled user', async () => {
    await db.user.update({
      where: { id: world.users.governor.id },
      data: { disabledAt: new Date() },
    });
    expect(
      await memberships.findActiveForUser(world.users.governor.id, new Date('2026-10-15')),
    ).toEqual([]);
  });
});
