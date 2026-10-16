import { describe, expect, it, vi } from 'vitest';
import type { DocumentViewer } from '#src/repositories/document-visibility';
import type { ActiveMembership } from '#src/repositories/membership.repository';
import { createAccessService, type OrgRef } from '#src/services/access.service';

const ISSC = { id: 'issc', type: 'ISSC', parentId: null } as const;
const JPICE = { id: 'jpice', type: 'SBO', parentId: 'csc-cea' } as const;
const IECEP = { id: 'iecep', type: 'SBO', parentId: 'csc-cea' } as const;
const JPICE_REF: OrgRef = { id: 'jpice', slug: 'jpice' };
const CTX = { method: 'PATCH', route: '/api/v1/documents/:documentId', ip: '10.0.0.1' };

function membership(
  organization: ActiveMembership['organization'],
  role: ActiveMembership['role'] = 'officer',
): ActiveMembership {
  return { id: crypto.randomUUID(), role, isHead: false, title: null, organization };
}

function userViewer(overrides: Partial<Extract<DocumentViewer, { kind: 'user' }>> = {}) {
  return {
    kind: 'user' as const,
    userId: 'u1',
    isAdmin: false,
    memberOrgIds: [],
    reviewableOrgIds: [],
    ...overrides,
  };
}

function serviceWith({
  active = [] as ActiveMembership[],
  viewer = userViewer(),
} = {}) {
  const record = vi.fn(() => Promise.resolve());
  const findActiveForUser = vi.fn(() => Promise.resolve(active));
  const now = new Date('2026-10-16T00:00:00Z');
  const service = createAccessService({
    memberships: { findActiveForUser },
    organizations: {
      findBySlug: (slug: string) =>
        Promise.resolve(
          slug === 'jpice' ? ({ id: 'jpice', slug: 'jpice' } as never) : null,
        ),
    },
    documents: { organizationOf: (id: string) => Promise.resolve(id === 'd1' ? JPICE_REF : null) },
    viewers: { forUser: () => Promise.resolve(viewer) },
    audit: { record },
    now: () => now,
  });
  return { service, record, findActiveForUser, now };
}

describe('accessService.requireRole', () => {
  it('grants a matching active membership in that organization, without auditing', async () => {
    const { service, record, findActiveForUser, now } = serviceWith({
      active: [membership(JPICE)],
    });
    await expect(service.requireRole('u1', JPICE_REF, ['officer'], CTX)).resolves.toBe(
      'membership',
    );
    expect(findActiveForUser).toHaveBeenCalledWith('u1', now);
    expect(record).not.toHaveBeenCalled();
  });

  it('refuses the same role held in a sibling organization (JPICE officer on IECEP)', async () => {
    const { service } = serviceWith({ active: [membership(JPICE)] });
    await expect(
      service.requireRole('u1', { id: 'iecep', slug: 'iecep' }, ['officer'], CTX),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a different role in the right organization', async () => {
    const { service } = serviceWith({ active: [membership(IECEP, 'adviser')] });
    await expect(
      service.requireRole('u1', { id: 'iecep', slug: 'iecep' }, ['officer'], CTX),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a user with no active memberships (ended terms are not returned)', async () => {
    const { service } = serviceWith();
    await expect(service.requireRole('u1', JPICE_REF, ['officer'], CTX)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('lets an ISSC admin through and audits the override', async () => {
    const { service, record } = serviceWith({ active: [membership(ISSC, 'admin')] });
    await expect(service.requireRole('admin1', JPICE_REF, ['officer'], CTX)).resolves.toBe(
      'admin_override',
    );
    expect(record).toHaveBeenCalledWith({
      action: 'admin_override',
      actorId: 'admin1',
      entityType: 'organization',
      entityId: 'jpice',
      organizationId: 'jpice',
      metadata: { required: 'role:officer', method: 'PATCH', route: CTX.route },
      ip: '10.0.0.1',
    });
  });

  it('does not treat admin on a non-ISSC organization as system-wide', async () => {
    const { service } = serviceWith({ active: [membership(IECEP, 'admin')] });
    await expect(service.requireRole('u1', JPICE_REF, ['officer'], CTX)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("does not audit an admin acting through their own organization's role", async () => {
    const { service, record } = serviceWith({ active: [membership(ISSC, 'admin')] });
    await service.requireRole('admin1', { id: 'issc', slug: 'issc' }, ['admin'], CTX);
    expect(record).not.toHaveBeenCalled();
  });
});

describe('accessService.requireApprover', () => {
  it("grants the approver of the organization's documents", async () => {
    const { service, record } = serviceWith({
      viewer: userViewer({ reviewableOrgIds: ['jpice'] }),
    });
    await expect(service.requireApprover('gov', JPICE_REF, CTX)).resolves.toBe('membership');
    expect(record).not.toHaveBeenCalled();
  });

  it('refuses members who are not approvers, such as its own officers', async () => {
    const { service } = serviceWith({ viewer: userViewer({ memberOrgIds: ['jpice'] }) });
    await expect(service.requireApprover('u1', JPICE_REF, CTX)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('lets an ISSC admin approve through an audited override', async () => {
    const { service, record } = serviceWith({ viewer: userViewer({ isAdmin: true }) });
    await expect(service.requireApprover('admin1', JPICE_REF, CTX)).resolves.toBe(
      'admin_override',
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin_override',
        metadata: expect.objectContaining({ required: 'approver' }) as unknown,
      }),
    );
  });
});

describe('accessService resolution', () => {
  it('resolves organizations by slug and by document', async () => {
    const { service } = serviceWith();
    expect(await service.resolveBySlug('jpice')).toEqual(JPICE_REF);
    expect(await service.resolveBySlug('nope')).toBeNull();
    expect(await service.resolveByDocument('d1')).toEqual(JPICE_REF);
    expect(await service.resolveByDocument('d2')).toBeNull();
  });
});
