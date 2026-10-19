import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Announcement, AnnouncementListResponse } from '@orghive/shared';
import { memoryCache } from '#src/lib/cache';
import { createAnnouncementRepository } from '#src/repositories/announcement.repository';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createAccountRepository } from '#src/repositories/account.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { createProjectRepository } from '#src/repositories/project.repository';
import { createAccessService } from '#src/services/access.service';
import { createAnnouncementService } from '#src/services/announcement.service';
import { createTokenService } from '#src/services/token.service';
import { testKeys } from './auth-fixtures';
import { buildComplianceWorld, type Person } from './compliance-fixtures';
import { testDb } from './db';
import { buildTestApp } from './helpers';

const db = testDb();
const tokens = createTokenService(testKeys());
let app: ReturnType<typeof buildTestApp>;
let ids: Record<Person, string>;
let clock = new Date('2026-10-16T00:00:00Z');

async function tokenOf(person: Person) {
  const { token } = await tokens.sign({
    userId: ids[person],
    passwordChangeRequired: false,
  });
  return token;
}

function call(method: 'get' | 'post' | 'patch' | 'delete', path: string, token?: string) {
  const req = request(app)[method](`/api/v1${path}`);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
}

const POST = { title: 'General assembly on Friday', body: 'All CEA-tizens.\n\nVenue: gym.' };

async function post(person: Person, slug: string, body: object = POST) {
  return call('post', `/organizations/${slug}/announcements`, await tokenOf(person)).send(body);
}

beforeAll(async () => {
  const built = await buildComplianceWorld(db);
  ids = built.ids;
  const accounts = createAccountRepository(db);
  const organizations = createOrganizationRepository(db);
  const announcements = createAnnouncementRepository(db);
  const audit = createAuditLogRepository(db);
  app = buildTestApp({
    tokens,
    access: createAccessService({
      accounts,
      organizations,
      documents: createDocumentRepository(db),
      projects: createProjectRepository(db),
      announcements,
    }),
    announcements: createAnnouncementService({
      announcements,
      organizations,
      accounts,
      audit,
      cache: memoryCache(),
      now: () => clock,
    }),
  });
});

describe('posting an update', () => {
  it('401s signed out and 400s an invalid body', async () => {
    await call('post', '/organizations/csc-cea/announcements').send(POST).expect(401);
    expect((await post('governor', 'csc-cea', { title: 'x', body: '' })).status).toBe(400);
  });

  it('403s anyone but the council’s own account, the ISSC included', async () => {
    for (const person of ['officer', 'psmeOfficer', 'catGovernor', 'isscPresident'] as const) {
      expect((await post(person, 'csc-cea')).status, person).toBe(403);
    }
  });

  it('403s an SBO, even for its own officers', async () => {
    const res = await post('officer', 'jpice');
    expect(res.status).toBe(403);
    expect((res.body as { error: { message: string } }).error.message).toBe(
      'Only the ISSC and the CSCs post updates',
    );
  });

  it('publishes at once for a CSC or ISSC account, audited', async () => {
    const res = await post('governor', 'csc-cea');
    expect(res.status).toBe(201);
    const created = res.body as Announcement;
    expect(created).toMatchObject({
      title: POST.title,
      publishedAt: clock.toISOString(),
      editedAt: null,
      organization: { slug: 'csc-cea', acronym: 'CSC-CEA' },
      canEdit: true,
    });
    expect((await post('isscPresident', 'issc')).status).toBe(201);
    const audits = await db.auditLog.findMany({ where: { entityId: created.id } });
    expect(audits).toEqual([
      expect.objectContaining({ action: 'announcement_change', metadata: { change: 'publish' } }),
    ]);
  });
});

describe('reading updates', () => {
  it('lists newest first for anyone, publicly cacheable, filterable by council', async () => {
    const res = await call('get', '/announcements').expect(200);
    expect(res.headers['cache-control']).toContain('public');
    const body = res.body as AnnouncementListResponse;
    expect(body.items.map((a) => a.organization.slug)).toEqual(['issc', 'csc-cea']);
    expect(body.items.every((a) => !a.canEdit)).toBe(true);
    expect(body.canPostFor).toEqual([]);
    const cea = (await call('get', '/announcements?org=csc-cea').expect(200))
      .body as AnnouncementListResponse;
    expect(cea.items.map((a) => a.organization.slug)).toEqual(['csc-cea']);
    await call('get', '/announcements?org=nobody').expect(404);
  });

  it('tells a signed-in officer where they can post and what they can edit', async () => {
    const res = await call('get', '/announcements', await tokenOf('governor')).expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    const body = res.body as AnnouncementListResponse;
    expect(body.canPostFor.map((o) => o.slug)).toEqual(['csc-cea']);
    expect(body.items.map((a) => [a.organization.slug, a.canEdit])).toEqual([
      ['issc', false],
      ['csc-cea', true],
    ]);
    // An SBO officer can post nowhere.
    const sbo = (await call('get', '/announcements', await tokenOf('officer')).expect(200))
      .body as AnnouncementListResponse;
    expect(sbo.canPostFor).toEqual([]);
  });

  it('shows one update, or 404', async () => {
    const [latest] = (
      (await call('get', '/announcements').expect(200)).body as AnnouncementListResponse
    ).items;
    const res = await call('get', `/announcements/${latest!.id}`).expect(200);
    expect((res.body as Announcement).title).toBe(POST.title);
    await call('get', '/announcements/0195f3c0-0000-7000-8000-00000000dead').expect(404);
  });
});

describe('editing and deleting', () => {
  async function ceaUpdate(): Promise<Announcement> {
    const body = (await call('get', '/announcements?org=csc-cea').expect(200))
      .body as AnnouncementListResponse;
    return body.items[0]!;
  }

  it('lets only the council’s account edit; later edits show as edited', async () => {
    const update = await ceaUpdate();
    for (const person of ['officer', 'catGovernor', 'admin'] as const) {
      const res = await call('patch', `/announcements/${update.id}`, await tokenOf(person)).send({
        title: 'Hijacked',
      });
      expect(res.status, person).toBe(403);
    }
    clock = new Date('2026-10-16T03:00:00Z');
    const res = await call('patch', `/announcements/${update.id}`, await tokenOf('governor'))
      .send({ title: 'General assembly moved to Saturday' })
      .expect(200);
    expect(res.body as Announcement).toMatchObject({
      title: 'General assembly moved to Saturday',
      editedAt: '2026-10-16T03:00:00.000Z',
    });
  });

  it('shows the edit to signed-out readers at once (the cached list is cleared)', async () => {
    expect((await ceaUpdate()).title).toBe('General assembly moved to Saturday');
  });

  it('soft-deletes, audited; the update is gone for everyone', async () => {
    const update = await ceaUpdate();
    await call('delete', `/announcements/${update.id}`, await tokenOf('officer')).expect(403);
    await call('delete', `/announcements/${update.id}`, await tokenOf('governor')).expect(204);
    await call('get', `/announcements/${update.id}`).expect(404);
    await call('delete', `/announcements/${update.id}`, await tokenOf('governor')).expect(404);
    const row = await db.announcement.findUniqueOrThrow({ where: { id: update.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { entityId: update.id, action: 'delete' } })).toBe(1);
  });
});
