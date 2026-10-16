import { describe, expect, it, vi } from 'vitest';
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
  const listIds = vi.fn(({ type, parentIds }: { type?: string; parentIds?: string[] }) =>
    Promise.resolve(
      type === 'SBO' && parentIds?.includes('csc-cea')
        ? ['jpice', 'psme']
        : type === 'CSC'
          ? ['csc-cea', 'csc-cat']
          : [],
    ),
  );
  const service = createDocumentViewerService({
    memberships: { findActiveForUser: () => Promise.resolve(active) },
    organizations: { listIds },
  });
  return { service, listIds };
}

describe('documentViewerService.forUser', () => {
  it('gives a plain officer their own organization and no review rights', async () => {
    const { service } = serviceWith([membership({ organization: JPICE })]);
    expect(await service.forUser('u1')).toEqual({
      kind: 'user',
      userId: 'u1',
      isAdmin: false,
      memberOrgIds: ['jpice'],
      reviewableOrgIds: [],
    });
  });

  it('lets the CSC head (Governor) review the SBOs under that CSC', async () => {
    const { service, listIds } = serviceWith([membership({ organization: CSC_CEA, isHead: true })]);
    const viewer = await service.forUser('gov');
    expect(listIds).toHaveBeenCalledWith({ type: 'SBO', parentIds: ['csc-cea'] });
    expect(viewer).toMatchObject({ reviewableOrgIds: ['jpice', 'psme'] });
  });

  it('lets the ISSC head review CSC documents (provisional rule)', async () => {
    const { service } = serviceWith([membership({ organization: ISSC, isHead: true })]);
    expect(await service.forUser('pres')).toMatchObject({
      reviewableOrgIds: ['csc-cea', 'csc-cat'],
    });
  });

  it('lets the ISSC adviser review ISSC documents', async () => {
    const { service } = serviceWith([membership({ organization: ISSC, role: 'adviser' })]);
    expect(await service.forUser('adv')).toMatchObject({ reviewableOrgIds: ['issc'] });
  });

  it('does not give an SBO adviser review rights (not in the confirmed chain)', async () => {
    const { service } = serviceWith([membership({ organization: JPICE, role: 'adviser' })]);
    expect(await service.forUser('adv')).toMatchObject({ reviewableOrgIds: [] });
  });

  it('treats only an ISSC admin membership as system-wide admin', async () => {
    expect(
      await serviceWith([membership({ organization: ISSC, role: 'admin' })]).service.forUser('a'),
    ).toMatchObject({ isAdmin: true });
    expect(
      await serviceWith([membership({ organization: JPICE, role: 'admin' })]).service.forUser('b'),
    ).toMatchObject({ isAdmin: false });
  });

  it('grants nothing without active memberships', async () => {
    expect(await serviceWith([]).service.forUser('x')).toMatchObject({
      isAdmin: false,
      memberOrgIds: [],
      reviewableOrgIds: [],
    });
  });
});
