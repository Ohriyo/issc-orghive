import { describe, expect, it, vi } from 'vitest';
import type { Account, AccountOrganization } from '#src/repositories/account.repository';
import { createAccessService, type OrgRef } from '#src/services/access.service';

const org = (id: string, type: 'ISSC' | 'CSC' | 'SBO', parentId: string | null) =>
  ({
    id,
    type,
    parentId,
    slug: id,
    acronym: id.toUpperCase(),
    name: id,
    logoKey: null,
    logoWidths: [],
  }) satisfies AccountOrganization;

const ISSC = org('issc', 'ISSC', null);
const CSC_CEA = org('csc-cea', 'CSC', 'issc');
const CSC_CAT = org('csc-cat', 'CSC', 'issc');
const JPICE = org('jpice', 'SBO', 'csc-cea');
const IECEP = org('iecep', 'SBO', 'csc-cea');
const JPICE_REF: OrgRef = { id: 'jpice', slug: 'jpice' };
const ORGS = new Map([ISSC, CSC_CEA, CSC_CAT, JPICE, IECEP].map((o) => [o.slug, o]));

function serviceWith({
  account = null as AccountOrganization | null,
  deactivatedAt = null as Date | null,
} = {}) {
  const findAccount = vi.fn(() =>
    Promise.resolve(account ? ({ userId: 'u1', organization: account } satisfies Account) : null),
  );
  const service = createAccessService({
    accounts: { findAccount },
    organizations: {
      findBySlug: (slug: string) => {
        const found = ORGS.get(slug);
        return Promise.resolve(found ? ({ ...found, deactivatedAt } as never) : null);
      },
    },
    documents: { organizationOf: (id: string) => Promise.resolve(id === 'd1' ? JPICE_REF : null) },
    projects: { organizationOf: (id: string) => Promise.resolve(id === 'p1' ? JPICE_REF : null) },
  });
  return { service, findAccount };
}

describe('accessService.requireOrgAccess (shared organization accounts)', () => {
  it('lets the organization’s own account through, for both scopes', async () => {
    const { service, findAccount } = serviceWith({ account: JPICE });
    await expect(service.requireOrgAccess('u1', JPICE_REF, 'own')).resolves.toBeUndefined();
    await expect(service.requireOrgAccess('u1', JPICE_REF, 'governing')).resolves.toBeUndefined();
    expect(findAccount).toHaveBeenCalledWith('u1');
  });

  it('lets a governing body through only where the governing scope applies', async () => {
    for (const governing of [CSC_CEA, ISSC]) {
      const { service } = serviceWith({ account: governing });
      await expect(service.requireOrgAccess('u1', JPICE_REF, 'governing')).resolves.toBeUndefined();
      await expect(service.requireOrgAccess('u1', JPICE_REF, 'own')).rejects.toMatchObject({
        status: 403,
      });
    }
  });

  it('refuses a sibling SBO, another college’s CSC, and an account acting for nobody', async () => {
    for (const account of [IECEP, CSC_CAT, null]) {
      const { service } = serviceWith({ account });
      await expect(service.requireOrgAccess('u1', JPICE_REF, 'governing')).rejects.toMatchObject({
        status: 403,
      });
    }
  });
});

describe('accessService resolution', () => {
  it('resolves organizations by slug, by document and by project', async () => {
    const { service } = serviceWith();
    expect(await service.resolveBySlug('jpice')).toEqual(JPICE_REF);
    expect(await service.resolveBySlug('nope')).toBeNull();
    expect(await service.resolveByDocument('d1')).toEqual(JPICE_REF);
    expect(await service.resolveByDocument('d2')).toBeNull();
    expect(await service.resolveByProject('p1')).toEqual(JPICE_REF);
    expect(await service.resolveByProject('p2')).toBeNull();
  });
});

describe('accessService.requireAdmin', () => {
  it('passes the ISSC account only', async () => {
    await expect(
      serviceWith({ account: ISSC }).service.requireAdmin('u1'),
    ).resolves.toBeUndefined();
    for (const account of [CSC_CEA, JPICE, null]) {
      await expect(serviceWith({ account }).service.requireAdmin('u1')).rejects.toMatchObject({
        status: 403,
      });
    }
  });
});

describe('accessService.requireActive', () => {
  it('lets an active organization through', async () => {
    await expect(serviceWith().service.requireActive(JPICE_REF)).resolves.toBeUndefined();
  });

  it('refuses a deactivated organization with ORGANIZATION_INACTIVE', async () => {
    const { service } = serviceWith({ deactivatedAt: new Date('2026-10-01') });
    await expect(service.requireActive(JPICE_REF)).rejects.toMatchObject({
      status: 403,
      code: 'ORGANIZATION_INACTIVE',
    });
  });
});
