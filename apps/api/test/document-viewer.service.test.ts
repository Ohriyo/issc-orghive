import { describe, expect, it } from 'vitest';
import type { AccountOrganization } from '#src/repositories/account.repository';
import { createDocumentViewerService } from '#src/services/document-viewer.service';

const org = (id: string, type: 'ISSC' | 'CSC' | 'SBO', parentId: string | null) =>
  ({
    id,
    type,
    parentId,
    slug: id,
    acronym: id,
    name: id,
    logoKey: null,
    logoWidths: [],
  }) satisfies AccountOrganization;

function serviceWith(organization: AccountOrganization | null) {
  return createDocumentViewerService({
    accounts: {
      findAccount: (userId) => Promise.resolve(organization ? { userId, organization } : null),
    },
  });
}

describe('documentViewerService.forUser', () => {
  it('makes a shared account the viewer of its own organization', async () => {
    expect(await serviceWith(org('jpice', 'SBO', 'csc-cea')).forUser('u1')).toEqual({
      kind: 'account',
      userId: 'u1',
      organizationId: 'jpice',
      organizationType: 'SBO',
    });
    expect(await serviceWith(org('issc', 'ISSC', null)).forUser('u2')).toMatchObject({
      organizationType: 'ISSC',
    });
  });

  it('makes an account acting for no organization (super admin, locked) a public viewer', async () => {
    expect(await serviceWith(null).forUser('x')).toEqual({ kind: 'public' });
  });
});
