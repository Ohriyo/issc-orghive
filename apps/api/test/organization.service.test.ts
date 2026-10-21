import { describe, expect, it, vi } from 'vitest';
import { memoryCache } from '#src/lib/cache';
import { createPublicUrl } from '#src/lib/public-url';
import type { PublicProfileRecord } from '#src/repositories/organization.repository';
import { createOrganizationService } from '#src/services/organization.service';

const CSC_CEA_PARENT = {
  type: 'CSC',
  slug: 'csc-cea',
  acronym: 'CSC-CEA',
  name: 'CSC of CEA',
  logoKey: null,
  logoWidths: [] as number[],
  deletedAt: null,
} as const;

const JPICE: PublicProfileRecord = {
  id: 'jpice-id',
  deactivatedAt: null,
  constitutionDocumentId: null,
  type: 'SBO',
  slug: 'jpice',
  acronym: 'JPICE',
  name: 'Junior Philippine Institute of Civil Engineers',
  description: 'Civil engineering students',
  logoKey: 'logos/jpice-ab12.webp',
  logoWidths: [256, 128],
  parentId: 'csc-cea-id',
  parent: CSC_CEA_PARENT,
  college: {
    id: 'cea-id',
    code: 'CEA',
    slug: 'cea',
    name: 'College of Engineering and Architecture',
  },
  mission: 'To shape competent civil engineers.',
  vision: null,
  contactEmail: 'jpice@nwssu.edu.ph',
  facebookUrl: 'https://www.facebook.com/jpice.nwssu',
  coverKey: 'logos/covers/jpice-cd34.webp',
  coverWidths: [640],
  officers: [{ position: 'President', name: 'Ana Reyes' }],
  links: [{ url: 'https://instagram.com/jpice' }, { url: 'https://jpice.example.org' }],
};

function serviceWith(orgs: PublicProfileRecord[]) {
  const findBySlug = vi.fn((slug: string) =>
    Promise.resolve(orgs.find((o) => o.slug === slug) ?? null),
  );
  const cache = memoryCache();
  const service = createOrganizationService({
    organizations: { findPublicProfile: findBySlug },
    cache,
    publicUrl: createPublicUrl('https://cdn.test'),
  });
  return { service, findBySlug, cache };
}

describe('organizationService.getBySlug', () => {
  it('returns the profile with parent, college and public logo URL', async () => {
    const { service } = serviceWith([JPICE]);
    expect(await service.getBySlug('jpice')).toEqual({
      id: 'jpice-id',
      type: 'SBO',
      slug: 'jpice',
      acronym: 'JPICE',
      name: JPICE.name,
      description: 'Civil engineering students',
      logoUrl: 'https://cdn.test/logos/jpice-ab12.webp',
      logoSrcSet:
        'https://cdn.test/logos/jpice-ab12-128.webp 128w, https://cdn.test/logos/jpice-ab12-256.webp 256w',
      parent: {
        type: 'CSC',
        slug: 'csc-cea',
        acronym: 'CSC-CEA',
        name: 'CSC of CEA',
        logoUrl: null,
        logoSrcSet: null,
      },
      college: { code: 'CEA', slug: 'cea', name: 'College of Engineering and Architecture' },
      mission: 'To shape competent civil engineers.',
      vision: null,
      contactEmail: 'jpice@nwssu.edu.ph',
      links: [
        { url: 'https://www.facebook.com/jpice.nwssu', kind: 'facebook', label: 'Facebook' },
        { url: 'https://instagram.com/jpice', kind: 'instagram', label: 'Instagram' },
        { url: 'https://jpice.example.org', kind: 'website', label: 'jpice.example.org' },
      ],
      officers: [{ position: 'President', name: 'Ana Reyes' }],
      coverUrl: 'https://cdn.test/logos/covers/jpice-cd34.webp',
      coverSrcSet: 'https://cdn.test/logos/covers/jpice-cd34-640.webp 640w',
    });
  });

  it('lists no Facebook link when the organization has none', async () => {
    const { service } = serviceWith([{ ...JPICE, facebookUrl: null, links: [] }]);
    expect((await service.getBySlug('jpice')).links).toEqual([]);
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
    expect(cache.store.has('org:jpice:v2')).toBe(true);
  });

  it('throws 404 for an unknown slug and does not cache the miss', async () => {
    const { service, cache } = serviceWith([JPICE]);
    await expect(service.getBySlug('nope')).rejects.toMatchObject({ status: 404 });
    expect(cache.store.size).toBe(0);
  });
});
