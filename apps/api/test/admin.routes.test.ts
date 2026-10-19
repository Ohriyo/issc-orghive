import sharp from 'sharp';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { memoryCache } from '#src/lib/cache';
import { createPublicUrl } from '#src/lib/public-url';
import { createAdminOrganizationRepository } from '#src/repositories/admin-organization.repository';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createAccountRepository } from '#src/repositories/account.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { createProjectRepository } from '#src/repositories/project.repository';
import { createAccessService } from '#src/services/access.service';
import { createAdminOrganizationService } from '#src/services/admin-organization.service';
import { createTokenService } from '#src/services/token.service';
import { testKeys } from './auth-fixtures';
import { buildWorld, resetDb, testDb, type World } from './db';
import { buildTestApp } from './helpers';

const db = testDb();
const tokens = createTokenService(testKeys());
let world: World;
let app: ReturnType<typeof buildTestApp>;
const tokenOf = {} as Record<'admin' | 'officer' | 'pastAdmin', string>;

const days = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

async function signFor(userId: string) {
  const { token } = await tokens.sign({
    userId,
    passwordChangeRequired: false,
  });
  return token;
}

beforeAll(async () => {
  await resetDb(db);
  world = await buildWorld(db);
  // The ISSC's shared account is the admin. A former ISSC account, now deactivated, still has
  // a valid token: the database decides, so it is refused.
  tokenOf.admin = await signFor(world.users.issc.id);
  const past = await db.user.create({
    data: {
      email: 'past.issc@admin.test',
      name: 'past',
      passwordHash: 'x',
      organizationId: world.orgs.issc.id,
      disabledAt: days(-1),
    },
  });
  tokenOf.pastAdmin = await signFor(past.id);
  tokenOf.officer = await signFor(world.users.officer.id);

  const audit = createAuditLogRepository(db);
  app = buildTestApp({
    tokens,
    access: createAccessService({
      accounts: createAccountRepository(db),
      organizations: createOrganizationRepository(db),
      documents: createDocumentRepository(db),
      projects: createProjectRepository(db),
    }),
    adminOrganizations: createAdminOrganizationService({
      admin: createAdminOrganizationRepository(db),
      audit,
      cache: memoryCache(),
      storage: { put: () => Promise.resolve() },
      publicUrl: createPublicUrl('https://cdn.test'),
    }),
  });
});

const call = (method: 'get' | 'post' | 'patch' | 'put', path: string, token?: string) => {
  const req = request(app)[method](`/api/v1/admin${path}`);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

describe('/admin access', () => {
  const routes: ['get' | 'post' | 'patch' | 'put', string][] = [
    ['get', '/organizations'],
    ['post', '/colleges'],
    ['put', '/colleges/order'],
    ['patch', '/colleges/cea'],
    ['put', '/colleges/cea/organizations/order'],
    ['post', '/organizations'],
    ['patch', '/organizations/jpice'],
    ['put', '/organizations/jpice/active'],
    ['put', '/organizations/jpice/logo'],
  ];

  it.each(routes)('%s %s: 401 signed out', async (method, path) => {
    await call(method, path).expect(401);
  });

  it.each(routes)(
    '%s %s: 403 for an officer, even with an admin claim in the token',
    async (method, path) => {
      await call(method, path, tokenOf.officer).expect(403);
    },
  );

  it('403s an admin whose term has ended', async () => {
    await call('get', '/organizations', tokenOf.pastAdmin).expect(403);
  });

  it('serves the tree to an admin, never cached', async () => {
    const res = await call('get', '/organizations', tokenOf.admin).expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect((res.body as { issc: { slug: string } }).issc.slug).toBe('issc');
  });
});

describe('/admin writes', () => {
  it('validates bodies with the shared schemas', async () => {
    await call('post', '/colleges', tokenOf.admin)
      .send({ code: 'C1', slug: 'Bad Slug', name: 'x' })
      .expect(400);
    await call('put', '/organizations/jpice/active', tokenOf.admin)
      .send({ active: 'no' })
      .expect(400);
  });

  it('deactivates and reactivates an organization', async () => {
    const off = await call('put', '/organizations/psme/active', tokenOf.admin)
      .send({ active: false })
      .expect(200);
    expect((off.body as { active: boolean }).active).toBe(false);
    await call('put', '/organizations/psme/active', tokenOf.admin)
      .send({ active: true })
      .expect(200);
  });

  it('accepts a logo as raw image bytes', async () => {
    const png = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 9, g: 93, b: 64 } },
    })
      .png()
      .toBuffer();
    const res = await call('put', '/organizations/jpice/logo', tokenOf.admin)
      .set('Content-Type', 'image/png')
      .send(png)
      .expect(200);
    expect((res.body as { logoUrl: string }).logoUrl).toMatch(/\/logos\/jpice-[0-9a-f]{12}\.webp$/);
  });

  it('refuses a logo sent as another type (400) or over 2 MB (413)', async () => {
    await call('put', '/organizations/jpice/logo', tokenOf.admin)
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('%PDF-1.7'))
      .expect(400);
    await call('put', '/organizations/jpice/logo', tokenOf.admin)
      .set('Content-Type', 'image/png')
      .send(Buffer.alloc(2 * 1024 * 1024 + 1))
      .expect(413);
  });
});
