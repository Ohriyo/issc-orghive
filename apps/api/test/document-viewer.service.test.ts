import { describe, expect, it } from 'vitest';
import type { ActiveMembership } from '#src/repositories/membership.repository';
import { createDocumentViewerService } from '#src/services/document-viewer.service';

function membership(
  partial: Partial<ActiveMembership> & { organization: ActiveMembership['organization'] },
): ActiveMembership {
  return { id: crypto.randomUUID(), role: 'officer', isHead: false, title: null, ...partial };
}

const ISSC = { id: 'issc', type: 'ISSC', parentId: null } as const;
const CSC_CEA = { id: 'csc-cea', type: 'CSC', parentId: 'issc' } as const;
const JPICE = { id: 'jpice', type: 'SBO', parentId: 'csc-cea' } as const;

function serviceWith(active: ActiveMembership[]) {
  return createDocumentViewerService({
    memberships: { findActiveForUser: () => Promise.resolve(active) },
  });
}

describe('documentViewerService.forUser', () => {
  it('makes an officer a member and an officer of their own organization only', async () => {
    expect(await serviceWith([membership({ organization: JPICE })]).forUser('u1')).toEqual({
      kind: 'user',
      userId: 'u1',
      isAdmin: false,
      memberOrgIds: ['jpice'],
      officerOrgIds: ['jpice'],
    });
  });

  it('makes an adviser a member, not an officer', async () => {
    const viewer = await serviceWith([
      membership({ organization: JPICE, role: 'adviser' }),
    ]).forUser('adv');
    expect(viewer).toMatchObject({ memberOrgIds: ['jpice'], officerOrgIds: [] });
  });

  it('gives a parent council’s head nothing in the organizations below it', async () => {
    const viewer = await serviceWith([membership({ organization: CSC_CEA, isHead: true })]).forUser(
      'gov',
    );
    expect(viewer).toMatchObject({ memberOrgIds: ['csc-cea'], officerOrgIds: ['csc-cea'] });
  });

  it('lists each organization once when the user holds several roles in it', async () => {
    const viewer = await serviceWith([
      membership({ organization: JPICE }),
      membership({ organization: JPICE, role: 'adviser' }),
    ]).forUser('u1');
    expect(viewer).toMatchObject({ memberOrgIds: ['jpice'], officerOrgIds: ['jpice'] });
  });

  it('treats only an ISSC admin membership as system-wide admin', async () => {
    expect(
      await serviceWith([membership({ organization: ISSC, role: 'admin' })]).forUser('a'),
    ).toMatchObject({ isAdmin: true, officerOrgIds: [] });
    expect(
      await serviceWith([membership({ organization: JPICE, role: 'admin' })]).forUser('b'),
    ).toMatchObject({ isAdmin: false });
  });

  it('grants nothing without active memberships', async () => {
    expect(await serviceWith([]).forUser('x')).toMatchObject({
      isAdmin: false,
      memberOrgIds: [],
      officerOrgIds: [],
    });
  });
});
