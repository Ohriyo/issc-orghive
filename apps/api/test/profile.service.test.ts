import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { ProfileFields } from '@orghive/shared';
import { memoryCache } from '#src/lib/cache';
import { createPublicUrl } from '#src/lib/public-url';
import type { ProfileRecord } from '#src/repositories/profile.repository';
import { createProfileService } from '#src/services/profile.service';

const AT = new Date('2026-10-21T00:00:00Z');
const ACTOR = { userId: 'u1', ip: '10.0.0.1' };
const JPICE = { id: 'jpice-id', slug: 'jpice' };

function record(overrides: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    id: 'jpice-id',
    slug: 'jpice',
    type: 'SBO',
    acronym: 'JPICE',
    name: 'Junior Philippine Institute of Civil Engineers',
    description: 'Civil engineering students.',
    mission: null,
    vision: null,
    contactEmail: null,
    facebookUrl: null,
    logoKey: 'logos/jpice-ab12.webp',
    coverKey: null,
    updatedAt: AT,
    college: { code: 'CEA', slug: 'cea', name: 'College of Engineering and Architecture' },
    officers: [{ position: 'President', name: 'Ana Reyes', isPublic: true }],
    links: [{ url: 'https://instagram.com/jpice' }],
    ...overrides,
  };
}

function setup(current: ProfileRecord | null = record()) {
  const profiles = {
    findById: vi.fn(() => Promise.resolve(current)),
    save: vi.fn((_id: string, fields: ProfileFields) =>
      Promise.resolve(record({ mission: fields.mission, links: [], officers: [] })),
    ),
    setLogo: vi.fn((_id: string, logoKey: string) => Promise.resolve(record({ logoKey }))),
    setCover: vi.fn((_id: string, coverKey: string | null) => Promise.resolve(record({ coverKey }))),
  };
  const storage = { put: vi.fn(() => Promise.resolve()) };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  const cache = memoryCache();
  const service = createProfileService({
    profiles,
    storage,
    audit,
    cache,
    publicUrl: createPublicUrl('https://cdn.test'),
  });
  return { service, profiles, storage, audit, cache };
}

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#095d40' } }).png().toBuffer();

describe('profileService.get', () => {
  it('shows the official fields as read-only and every officer, hidden ones included', async () => {
    const hidden = { position: 'Treasurer', name: 'Ben Cruz', isPublic: false };
    const { service } = setup(record({ officers: [hidden] }));
    expect(await service.get(JPICE)).toMatchObject({
      official: { name: 'Junior Philippine Institute of Civil Engineers', acronym: 'JPICE' },
      officers: [hidden],
      links: [{ url: 'https://instagram.com/jpice', kind: 'instagram', label: 'Instagram' }],
      logoUrl: 'https://cdn.test/logos/jpice-ab12.webp',
      coverUrl: null,
    });
  });

  it('404s a deleted organization', async () => {
    await expect(setup(null).service.get(JPICE)).rejects.toMatchObject({ status: 404 });
  });
});

describe('profileService.save', () => {
  const input = {
    description: 'Civil engineering students.',
    mission: 'Shape engineers.',
    vision: null,
    contactEmail: null,
    facebookUrl: null,
    links: ['https://instagram.com/jpice'],
    officers: [{ position: 'President', name: 'Ana Reyes', isPublic: true }],
    actingAs: 'Ana Reyes',
  };

  it('saves without Acting as, audits what changed with it, and clears the public pages', async () => {
    const { service, profiles, audit, cache } = setup();
    cache.store.set('org:jpice:v2', '{}');
    cache.store.set('college:cea', '{}');
    await service.save(ACTOR, JPICE, input);
    const { actingAs: _actingAs, ...fields } = input;
    expect(profiles.save).toHaveBeenCalledWith('jpice-id', fields);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'organization_change',
        actingAs: 'Ana Reyes',
        organizationId: 'jpice-id',
        metadata: { change: 'profile', fields: ['mission'] },
      }),
    );
    expect(cache.store.has('org:jpice:v2')).toBe(false);
    expect(cache.store.has('college:cea')).toBe(false);
  });

  it('lists officers and links as changed when they differ', async () => {
    const { service, audit } = setup();
    await service.save(ACTOR, JPICE, { ...input, mission: null, links: [], officers: [] });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { change: 'profile', fields: ['links', 'officers'] } }),
    );
  });
});

describe('profileService images', () => {
  it('crops the logo to a square, stores every size and audits it', async () => {
    const { service, storage, profiles, audit } = setup();
    await service.setLogo(ACTOR, JPICE, await png(400, 200), 'Ana Reyes');
    const keys = storage.put.mock.calls.map((call) => (call as unknown as [string])[0]);
    expect(keys[0]).toMatch(/^logos\/jpice-[0-9a-f]{12}\.webp$/);
    const stored = (storage.put.mock.calls[0] as unknown as [string, Buffer])[1];
    const meta = await sharp(stored).metadata();
    expect([meta.width, meta.height]).toEqual([200, 200]);
    expect(profiles.setLogo).toHaveBeenCalledWith('jpice-id', keys[0], expect.any(Array));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actingAs: 'Ana Reyes', metadata: expect.objectContaining({ change: 'logo' }) as unknown }),
    );
  });

  it('400s a file that is not an image, naming the field', async () => {
    const { service, storage } = setup();
    await expect(
      service.setLogo(ACTOR, JPICE, Buffer.from('%PDF-1.7 not an image'), 'Ana Reyes'),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^logo: /) as unknown });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('stores a cover under logos/covers/ and refuses a narrow one', async () => {
    const { service, profiles } = setup();
    await service.setCover(ACTOR, JPICE, await png(1400, 500), 'Ana Reyes');
    expect(profiles.setCover).toHaveBeenCalledWith(
      'jpice-id',
      expect.stringMatching(/^logos\/covers\/jpice-/),
      expect.arrayContaining([640, 1280]),
    );
    await expect(
      service.setCover(ACTOR, JPICE, await png(600, 300), 'Ana Reyes'),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^cover: /) as unknown });
  });

  it('removes a cover once, audited, and does nothing when there is none', async () => {
    const withCover = setup(record({ coverKey: 'logos/covers/jpice-1.webp' }));
    await withCover.service.removeCover(ACTOR, JPICE, 'Ana Reyes');
    expect(withCover.profiles.setCover).toHaveBeenCalledWith('jpice-id', null, []);
    expect(withCover.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { change: 'cover_removed' } }),
    );

    const without = setup();
    await without.service.removeCover(ACTOR, JPICE, 'Ana Reyes');
    expect(without.profiles.setCover).not.toHaveBeenCalled();
    expect(without.audit.record).not.toHaveBeenCalled();
  });
});
