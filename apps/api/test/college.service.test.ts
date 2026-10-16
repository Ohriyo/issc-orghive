import { describe, expect, it, vi } from 'vitest';
import { memoryCache } from '#src/lib/cache';
import { createPublicUrl } from '#src/lib/public-url';
import type { CollegeRecord } from '#src/repositories/college.repository';
import type { OrganizationRecord } from '#src/repositories/organization.repository';
import { createCollegeService } from '#src/services/college.service';

const CSC_CEA = {
  id: 'csc-cea-id',
  type: 'CSC',
  slug: 'csc-cea',
  acronym: 'CSC-CEA',
  name: 'CSC of CEA',
  description: 'The CSC-CEA serves all CEA-tizens.',
  logoKey: 'logos/csc-cea.png',
} as const;

const CEA: CollegeRecord = {
  id: 'cea-id',
  code: 'CEA',
  slug: 'cea',
  name: 'College of Engineering and Architecture',
  motto: 'Build',
  description: 'Engineers',
  organizations: [CSC_CEA],
};

const CAT: CollegeRecord = {
  ...CEA,
  id: 'cat-id',
  code: 'CAT',
  slug: 'cat',
  name: 'College of Agriculture and Technology',
  organizations: [],
};

function sbo(slug: string): OrganizationRecord {
  return {
    id: `${slug}-id`,
    type: 'SBO',
    slug,
    acronym: slug.toUpperCase(),
    name: slug,
    description: null,
    logoKey: null,
    parentId: CSC_CEA.id,
    parent: null,
    college: null,
  };
}

function serviceWith(colleges: CollegeRecord[]) {
  const repo = {
    list: vi.fn(() => Promise.resolve(colleges)),
    findBySlug: vi.fn((slug: string) =>
      Promise.resolve(colleges.find((c) => c.slug === slug) ?? null),
    ),
  };
  const listChildren = vi.fn((parentId: string) =>
    Promise.resolve(parentId === CSC_CEA.id ? [sbo('jpice'), sbo('psme')] : []),
  );
  const cache = memoryCache();
  const service = createCollegeService({
    colleges: repo,
    organizations: { listChildren },
    cache,
    publicUrl: createPublicUrl('https://cdn.test'),
  });
  return { service, repo, listChildren, cache };
}

describe('collegeService.list', () => {
  it('returns each college with its CSC and a public logo URL', async () => {
    const { service } = serviceWith([CAT, CEA]);
    expect(await service.list()).toEqual({
      colleges: [
        { code: 'CAT', slug: 'cat', name: CAT.name, motto: 'Build', csc: null },
        {
          code: 'CEA',
          slug: 'cea',
          name: CEA.name,
          motto: 'Build',
          csc: {
            type: 'CSC',
            slug: 'csc-cea',
            acronym: 'CSC-CEA',
            name: 'CSC of CEA',
            logoUrl: 'https://cdn.test/logos/csc-cea.png',
          },
        },
      ],
    });
  });

  it('caches the list under college:list', async () => {
    const { service, repo, cache } = serviceWith([CEA]);
    await service.list();
    await service.list();
    expect(repo.list).toHaveBeenCalledTimes(1);
    expect(cache.store.has('college:list')).toBe(true);
  });
});

describe('collegeService.getBySlug', () => {
  it('includes the description and the CSC SBOs', async () => {
    const { service } = serviceWith([CEA]);
    const detail = await service.getBySlug('cea');
    expect(detail.description).toBe('Engineers');
    expect(detail.csc).toMatchObject({
      slug: 'csc-cea',
      description: 'The CSC-CEA serves all CEA-tizens.',
      logoUrl: 'https://cdn.test/logos/csc-cea.png',
    });
    expect(detail.sbos.map((o) => o.slug)).toEqual(['jpice', 'psme']);
  });

  it('returns no SBOs for a college without a CSC', async () => {
    const { service, listChildren } = serviceWith([CAT]);
    expect((await service.getBySlug('cat')).sbos).toEqual([]);
    expect(listChildren).not.toHaveBeenCalled();
  });

  it('caches the detail under college:{slug}', async () => {
    const { service, repo, cache } = serviceWith([CEA]);
    await service.getBySlug('cea');
    await service.getBySlug('cea');
    expect(repo.findBySlug).toHaveBeenCalledTimes(1);
    expect(cache.store.has('college:cea')).toBe(true);
  });

  it('throws 404 for an unknown slug and does not cache the miss', async () => {
    const { service, cache } = serviceWith([CEA]);
    await expect(service.getBySlug('nope')).rejects.toMatchObject({ status: 404 });
    expect(cache.store.has('college:nope')).toBe(false);
  });
});
