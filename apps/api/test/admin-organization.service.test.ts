import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheKeys, memoryCache } from '#src/lib/cache';
import { createPublicUrl } from '#src/lib/public-url';
import { createAdminOrganizationRepository } from '#src/repositories/admin-organization.repository';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createAdminOrganizationService } from '#src/services/admin-organization.service';
import { buildWorld, resetDb, testDb, type World } from './db';

const db = testDb();
let world: World;
const ACTOR = () => ({ userId: world.users.governor.id, ip: '10.0.0.9' });

function setup() {
  const cache = memoryCache();
  const stored = new Map<string, { contentType: string; cacheControl?: string }>();
  const leaderboard = { forOpenSemesters: vi.fn(() => Promise.resolve()) };
  const service = createAdminOrganizationService({
    admin: createAdminOrganizationRepository(db),
    audit: createAuditLogRepository(db),
    cache,
    storage: {
      put: (key, _body, contentType, cacheControl) => {
        stored.set(key, { contentType, cacheControl });
        return Promise.resolve();
      },
    },
    publicUrl: createPublicUrl('https://cdn.test'),
    leaderboard,
    now: () => new Date('2026-10-18T02:00:00Z'),
  });
  return { service, cache, stored, leaderboard };
}

const auditsOf = (action: 'organization_change' | 'college_change') =>
  db.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });

beforeEach(async () => {
  await resetDb(db);
  world = await buildWorld(db);
});

describe('adminOrganizationService.tree', () => {
  it('lists the ISSC, then each college with its CSC and SBOs and their counts', async () => {
    const tree = await setup().service.tree();
    expect(tree.issc).toMatchObject({ slug: 'issc', active: true });
    const cea = tree.colleges.find((c) => c.slug === 'cea')!;
    expect(cea.csc).toMatchObject({ slug: 'csc-cea', type: 'CSC' });
    expect(cea.sbos.map((o) => o.slug).sort()).toEqual(['jpice', 'psme']);
    // The world's JPICE has 7 documents, one of them deleted.
    expect(cea.sbos.find((o) => o.slug === 'jpice')!.documentCount).toBe(6);
  });
});

describe('colleges', () => {
  it('creates a college last in the carousel, audited, clearing the public cache', async () => {
    const { service, cache } = setup();
    cache.store.set('college:list', '{}');
    const created = await service.createCollege(ACTOR(), {
      code: 'COM',
      slug: 'com',
      name: 'College of Management',
    });
    expect(created).toMatchObject({ slug: 'com', csc: null, sbos: [] });
    expect((await service.tree()).colleges.at(-1)!.slug).toBe('com');
    expect(cache.store.has('college:list')).toBe(false);
    expect((await auditsOf('college_change'))[0]!.metadata).toEqual({
      change: 'create',
      slug: 'com',
    });
  });

  it('refuses a taken code (any case) or slug with 409', async () => {
    const { service } = setup();
    await expect(
      service.createCollege(ACTOR(), { code: 'cea', slug: 'new', name: 'Duplicate college' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.createCollege(ACTOR(), { code: 'NEW', slug: 'cea', name: 'Duplicate college' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('edits a college and 404s an unknown one', async () => {
    const { service } = setup();
    expect(await service.updateCollege(ACTOR(), 'cea', { motto: null })).toMatchObject({
      motto: null,
    });
    await expect(service.updateCollege(ACTOR(), 'nope', { motto: 'x' })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('reorders colleges only with every college listed once', async () => {
    const { service } = setup();
    const tree = await service.reorderColleges(ACTOR(), ['cea', 'cat']);
    expect(tree.colleges.map((c) => c.slug)).toEqual(['cea', 'cat']);
    await expect(service.reorderColleges(ACTOR(), ['cea'])).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('organizations', () => {
  it('creates an SBO under its college’s CSC, last in its carousel', async () => {
    const { service } = setup();
    const org = await service.createOrganization(ACTOR(), {
      type: 'SBO',
      collegeSlug: 'cea',
      slug: 'uapsa',
      acronym: 'UAPSA',
      name: 'United Architects of the Philippines Student Auxiliary',
    });
    expect(org).toMatchObject({ slug: 'uapsa', active: true, hasAccount: false });
    const row = await db.organization.findUniqueOrThrow({ where: { slug: 'uapsa' } });
    expect(row.parentId).toBe(world.orgs.cscCea.id);
    expect((await service.tree()).colleges[1]!.sbos.at(-1)!.slug).toBe('uapsa');
  });

  it('refuses a second CSC, an SBO without a CSC and a taken slug', async () => {
    const { service } = setup();
    const base = { slug: 'x-org', acronym: 'XO', name: 'Some organization' };
    await expect(
      service.createOrganization(ACTOR(), { ...base, type: 'CSC', collegeSlug: 'cea' }),
    ).rejects.toMatchObject({ status: 409 });
    await db.organization.update({
      where: { id: world.orgs.cscCat.id },
      data: { deletedAt: new Date() },
    });
    await expect(
      service.createOrganization(ACTOR(), { ...base, type: 'SBO', collegeSlug: 'cat' }),
    ).rejects.toMatchObject({ status: 409, message: 'Create the CSC of CAT first' });
    await expect(
      service.createOrganization(ACTOR(), {
        ...base,
        slug: 'jpice',
        type: 'SBO',
        collegeSlug: 'cea',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('edits an organization’s names and description, audited', async () => {
    const { service, cache } = setup();
    cache.store.set('org:jpice', '{}');
    const org = await service.updateOrganization(ACTOR(), 'jpice', { description: 'Civil.' });
    expect(org.description).toBe('Civil.');
    expect(cache.store.has('org:jpice')).toBe(false);
    expect((await auditsOf('organization_change'))[0]).toMatchObject({
      organizationId: world.orgs.jpice.id,
      metadata: { change: 'update', fields: ['description'] },
    });
  });

  it('deactivates and reactivates, auditing each change once', async () => {
    const { service, leaderboard } = setup();
    expect((await service.setActive(ACTOR(), 'jpice', false)).active).toBe(false);
    expect((await service.setActive(ACTOR(), 'jpice', false)).active).toBe(false);
    expect((await service.setActive(ACTOR(), 'jpice', true)).active).toBe(true);
    const changes = (await auditsOf('organization_change')).map(
      (a) => (a.metadata as { change: string }).change,
    );
    expect(changes).toEqual(['deactivate', 'activate']);
    // It leaves the boards and comes back (spec 5A): each real change recomputes them.
    expect(leaderboard.forOpenSemesters).toHaveBeenCalledTimes(2);
  });

  it('clears the cached leaderboard organizations on an edit', async () => {
    const { service, cache } = setup();
    cache.store.set(cacheKeys.leaderboardOrganizations(), '[]');
    await service.updateOrganization(ACTOR(), 'jpice', { name: 'Renamed JPICE' });
    expect(cache.store.has(cacheKeys.leaderboardOrganizations())).toBe(false);
  });

  it('never deactivates the ISSC', async () => {
    await expect(setup().service.setActive(ACTOR(), 'issc', false)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('reorders a college’s SBOs only with every SBO listed once', async () => {
    const { service } = setup();
    const cea = await service.reorderSbos(ACTOR(), 'cea', ['psme', 'jpice']);
    expect(cea.sbos.map((o) => o.slug)).toEqual(['psme', 'jpice']);
    await expect(service.reorderSbos(ACTOR(), 'cea', ['psme', 'csc-cea'])).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('adminOrganizationService.setLogo', () => {
  const png = (width: number) =>
    sharp({
      create: { width, height: width, channels: 3, background: { r: 9, g: 93, b: 64 } },
    })
      .png()
      .toBuffer();

  it('stores a WebP logo with srcset variants under a content-hashed public key', async () => {
    const { service, stored } = setup();
    const org = await service.setLogo(ACTOR(), 'jpice', await png(300));
    expect(org.logoUrl).toMatch(/^https:\/\/cdn\.test\/logos\/jpice-[0-9a-f]{12}\.webp$/);
    const row = await db.organization.findUniqueOrThrow({ where: { slug: 'jpice' } });
    expect(row.logoWidths).toEqual([128, 256, 300]);
    expect([...stored.keys()]).toHaveLength(4);
    for (const file of stored.values()) {
      expect(file).toEqual({
        contentType: 'image/webp',
        cacheControl: 'public, max-age=31536000, immutable',
      });
    }
  });

  it('refuses something that is not an image, or one too small, with 400', async () => {
    const { service } = setup();
    await expect(
      service.setLogo(ACTOR(), 'jpice', Buffer.from('%PDF-1.7 not a logo')),
    ).rejects.toMatchObject({ status: 400, message: 'logo: Upload a PNG, JPEG or WebP image' });
    await expect(service.setLogo(ACTOR(), 'jpice', await png(64))).rejects.toMatchObject({
      status: 400,
    });
  });
});
