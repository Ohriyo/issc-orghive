import request from 'supertest';
import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiErrorBodySchema,
  collegeDetailSchema,
  collegeListResponseSchema,
  organizationDetailSchema,
} from '@orghive/shared';
import { createRedisCache } from '#src/lib/cache';
import { createPublicUrl } from '#src/lib/public-url';
import { createCollegeRepository } from '#src/repositories/college.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { createCollegeService } from '#src/services/college.service';
import { createOrganizationService } from '#src/services/organization.service';
import { buildWorld, resetDb, testDb } from './db';
import { buildTestApp, TEST_ASSET_BASE_URL } from './helpers';
import { testRedis } from './redis';

const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300';

const db = testDb();
const redis = testRedis();

/** Fresh repositories per test so spies don't leak between tests. */
function buildApp() {
  const colleges = createCollegeRepository(db);
  const organizations = createOrganizationRepository(db);
  const cache = createRedisCache(redis, pino({ level: 'silent' }));
  const publicUrl = createPublicUrl(TEST_ASSET_BASE_URL);
  const app = buildTestApp({
    colleges: createCollegeService({ colleges, organizations, cache, publicUrl }),
    organizations: createOrganizationService({ organizations, cache, publicUrl }),
  });
  return { app, colleges, organizations };
}

beforeEach(async () => {
  await redis.flushdb();
  await resetDb(db);
  const world = await buildWorld(db);
  await db.organization.update({
    where: { id: world.orgs.jpice.id },
    data: { logoKey: 'logos/jpice.png' },
  });
});

afterAll(async () => {
  await redis.quit();
});

describe('GET /api/v1/colleges', () => {
  it('lists colleges with their CSC and public cache headers', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/v1/colleges');

    expect(res.status).toBe(200);
    const body = collegeListResponseSchema.parse(res.body);
    expect(body.colleges.map((c) => [c.slug, c.csc?.slug])).toEqual([
      ['cat', 'csc-cat'],
      ['cea', 'csc-cea'],
    ]);
    expect(res.headers['cache-control']).toBe(PUBLIC_CACHE);
    expect(res.headers.etag).toBeDefined();
  });

  it('serves the second call from the Redis cache', async () => {
    const { app, colleges } = buildApp();
    const list = vi.spyOn(colleges, 'list');

    const first = await request(app).get('/api/v1/colleges');
    // Change the source; a cached response must not see it.
    await db.college.update({ where: { slug: 'cea' }, data: { name: 'Renamed' } });
    const second = await request(app).get('/api/v1/colleges');

    expect(list).toHaveBeenCalledTimes(1);
    expect(second.body).toEqual(first.body);
    const ttl = await redis.ttl('college:list');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(600);
  });

  it('answers 304 when If-None-Match matches the ETag', async () => {
    const { app } = buildApp();
    const first = await request(app).get('/api/v1/colleges');
    const second = await request(app)
      .get('/api/v1/colleges')
      .set('If-None-Match', first.headers.etag as string);

    expect(second.status).toBe(304);
    expect(second.text).toBe('');
  });
});

describe('GET /api/v1/colleges/:slug', () => {
  it('returns the college with its CSC (and its description) and SBOs', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/v1/colleges/cea');

    expect(res.status).toBe(200);
    const body = collegeDetailSchema.parse(res.body);
    expect(body.csc?.slug).toBe('csc-cea');
    expect(body.csc?.description).toBe('The CSC-CEA serves all CEA-tizens.');
    expect(body.sbos.map((o) => o.slug)).toEqual(['jpice', 'psme']);
    expect(body.sbos[0]?.logoUrl).toBe(`${TEST_ASSET_BASE_URL}/logos/jpice.png`);
    expect(res.headers['cache-control']).toBe(PUBLIC_CACHE);
  });

  it('serves the second call from the Redis cache', async () => {
    const { app, colleges } = buildApp();
    const findBySlug = vi.spyOn(colleges, 'findBySlug');

    await request(app).get('/api/v1/colleges/cea');
    await request(app).get('/api/v1/colleges/cea');

    expect(findBySlug).toHaveBeenCalledTimes(1);
    expect(await redis.exists('college:cea')).toBe(1);
  });

  it('returns 404 for an unknown slug, uncached', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/v1/colleges/nope');

    expect(res.status).toBe(404);
    expect(apiErrorBodySchema.parse(res.body).error.code).toBe('NOT_FOUND');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(await redis.exists('college:nope')).toBe(0);
  });

  it('returns 400 for a malformed slug', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/v1/colleges/Not_A_Slug');

    expect(res.status).toBe(400);
    expect(apiErrorBodySchema.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/v1/organizations/:slug', () => {
  it('returns the organization with its parent, college and logo URL', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/v1/organizations/jpice');

    expect(res.status).toBe(200);
    expect(organizationDetailSchema.parse(res.body)).toMatchObject({
      type: 'SBO',
      slug: 'jpice',
      logoUrl: `${TEST_ASSET_BASE_URL}/logos/jpice.png`,
      parent: { slug: 'csc-cea', type: 'CSC' },
      college: { code: 'CEA' },
    });
    expect(res.headers['cache-control']).toBe(PUBLIC_CACHE);
  });

  it('returns the ISSC with no parent and no college', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/v1/organizations/issc');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ type: 'ISSC', parent: null, college: null });
  });

  it('serves the second call from the Redis cache', async () => {
    const { app, organizations } = buildApp();
    const findProfile = vi.spyOn(organizations, 'findPublicProfile');

    await request(app).get('/api/v1/organizations/jpice');
    await request(app).get('/api/v1/organizations/jpice');

    expect(findProfile).toHaveBeenCalledTimes(1);
    expect(await redis.exists('org:jpice:v2')).toBe(1);
  });

  it('returns 404 for an unknown slug', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/v1/organizations/nope');

    expect(res.status).toBe(404);
    expect(apiErrorBodySchema.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for a soft-deleted organization', async () => {
    await db.organization.update({ where: { slug: 'psme' }, data: { deletedAt: new Date() } });
    const { app } = buildApp();
    const res = await request(app).get('/api/v1/organizations/psme');

    expect(res.status).toBe(404);
  });
});

describe('GET /api/docs', () => {
  it('serves Swagger UI and the generated spec in development', async () => {
    const app = buildTestApp({}, { NODE_ENV: 'development' });

    const ui = await request(app).get('/api/docs/');
    expect(ui.status).toBe(200);
    expect(ui.text).toContain('swagger-ui');

    const spec = await request(app).get('/api/docs.json');
    expect(Object.keys(spec.body.paths as object)).toEqual([
      '/colleges',
      '/colleges/{slug}',
      '/organizations/{slug}',
      '/organizations/{slug}/constitution',
      '/handbook',
      '/handbook/editions',
      '/handbook/{year}',
      '/handbook/{year}/search',
      '/search',
      '/leaderboard',
      '/leaderboard/stream',
      '/demo-status',
    ]);
    expect(spec.body.components.schemas).toHaveProperty('CollegeDetail');
    expect(spec.body.components.schemas).toHaveProperty('LeaderboardResponse');
  });

  it('is not served outside development', async () => {
    const res = await request(buildTestApp()).get('/api/docs/');
    expect(res.status).toBe(404);
  });
});
