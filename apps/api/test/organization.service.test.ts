import { describe, expect, it, vi } from 'vitest';
import { memoryCache } from '#src/lib/cache';
import { createPublicUrl } from '#src/lib/public-url';
import type { OrganizationRecord } from '#src/repositories/organization.repository';
import { createOrganizationService } from '#src/services/organization.service';

const CSC_CEA_PARENT = {
  type: 'CSC',
  slug: 'csc-cea',
  acronym: 'CSC-CEA',
  name: 'CSC of CEA',
  logoKey: null,
  deletedAt: null,
} as const;

const JPICE: OrganizationRecord = {
  id: 'jpice-id',
  type: 'SBO',
  slug: 'jpice',
  acronym: 'JPICE',
  name: 'Junior Philippine Institute of Civil Engineers',
  description: 'Civil engineering students',
  logoKey: 'logos/jpice.png',
  parentId: 'csc-cea-id',
  parent: CSC_CEA_PARENT,
  college: {
    id: 'cea-id',
    code: 'CEA',
    slug: 'cea',
    name: 'College of Engineering and Architecture',
  },
};

function serviceWith(orgs: OrganizationRecord[]) {
  const findBySlug = vi.fn((slug: string) =>
    Promise.resolve(orgs.find((o) => o.slug === slug) ?? null),
  );
  const cache = memoryCache();
  const service = createOrganizationService({
    organizations: { findBySlug },
    cache,
    publicUrl: createPublicUrl('https://cdn.test'),
  });
  return { service, findBySlug, cache };
}

describe('organizationService.getBySlug', () => {
  it('returns the profile with parent, college and public logo URL', async () => {
    const { service } = serviceWith([JPICE]);
    expect(await service.getBySlug('jpice')).toEqual({
      type: 'SBO',
      slug: 'jpice',
      acronym: 'JPICE',
      name: JPICE.name,
      description: 'Civil engineering students',
      logoUrl: 'https://cdn.test/logos/jpice.png',
      parent: {
        type: 'CSC',
        slug: 'csc-cea',
        acronym: 'CSC-CEA',
        name: 'CSC of CEA',
        logoUrl: null,
      },
      college: { code: 'CEA', slug: 'cea', name: 'College of Engineering and Architecture' },
    });
  });

  it('hides a soft-deleted parent', async () => {
    const orphan = { ...JPICE, parent: { ...CSC_CEA_PARENT, deletedAt: new Date() } };
    const { service } = serviceWith([orphan]);
    expect((await service.getBySlug('jpice')).parent).toBeNull();
  });

  it('caches the profile under org:{slug}', async () => {
    const { service, findBySlug, cache } = serviceWith([JPICE]);
    await service.getBySlug('jpice');
    await service.getBySlug('jpice');
    expect(findBySlug).toHaveBeenCalledTimes(1);
    expect(cache.store.has('org:jpice')).toBe(true);
  });

  it('throws 404 for an unknown slug and does not cache the miss', async () => {
    const { service, cache } = serviceWith([JPICE]);
    await expect(service.getBySlug('nope')).rejects.toMatchObject({ status: 404 });
    expect(cache.store.size).toBe(0);
  });
});
