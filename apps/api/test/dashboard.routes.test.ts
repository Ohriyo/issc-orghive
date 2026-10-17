import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { dashboardResponseSchema, type DashboardResponse } from '@orghive/shared';
import { createPublicUrl } from '#src/lib/public-url';
import { createDashboardRepository } from '#src/repositories/dashboard.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createMembershipRepository } from '#src/repositories/membership.repository';
import { createDashboardService } from '#src/services/dashboard.service';
import { createDocumentViewerService } from '#src/services/document-viewer.service';
import { createTokenService } from '#src/services/token.service';
import { testKeys } from './auth-fixtures';
import { buildWorld, resetDb, TERM_END, TERM_START, testDb, type World } from './db';
import { buildTestApp, TEST_ASSET_BASE_URL } from './helpers';

const db = testDb();
const tokens = createTokenService(testKeys());

let world: World;
let app: ReturnType<typeof buildTestApp>;
const tokenOf = {} as Record<
  'officer' | 'governor' | 'outsider' | 'admin' | 'pastOfficer' | 'adviser' | 'secretary',
  string
>;

async function signFor(userId: string) {
  const { token } = await tokens.sign({
    userId,
    roles: [],
    isAdmin: false,
    passwordChangeRequired: false,
  });
  return token;
}

function dashboard(token?: string) {
  const req = request(app).get('/api/v1/me/dashboard');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
}

async function dashboardOf(token: string): Promise<DashboardResponse> {
  const res = await dashboard(token).expect(200);
  return dashboardResponseSchema.parse(res.body);
}

beforeAll(async () => {
  await resetDb(db);
  world = await buildWorld(db);
  const { users, orgs, docs } = world;

  const admin = await db.user.create({
    data: { email: 'admin@test.local', name: 'Admin', passwordHash: 'x' },
  });
  await db.membership.create({
    data: { userId: admin.id, organizationId: orgs.issc.id, role: 'admin', termStart: TERM_START },
  });
  const pastOfficer = await db.user.create({
    data: { email: 'past@test.local', name: 'Past officer', passwordHash: 'x' },
  });
  await db.membership.create({
    data: {
      userId: pastOfficer.id,
      organizationId: orgs.jpice.id,
      role: 'officer',
      termStart: new Date('2024-08-01'),
      termEnd: new Date('2025-07-31'),
    },
  });

  // JPICE's adviser (a member, not an officer) and a second officer who uploaded nothing.
  const adviser = await db.user.create({
    data: { email: 'adviser@test.local', name: 'Adviser', passwordHash: 'x' },
  });
  const secretary = await db.user.create({
    data: { email: 'secretary@test.local', name: 'Secretary', passwordHash: 'x' },
  });
  for (const [userId, role] of [
    [adviser.id, 'adviser'],
    [secretary.id, 'officer'],
  ] as const) {
    await db.membership.create({
      data: {
        userId,
        organizationId: orgs.jpice.id,
        role,
        termStart: TERM_START,
        termEnd: TERM_END,
      },
    });
  }

  // Activity: JPICE entries (one about a since-deleted document, one historical approval
  // from before reviews were removed) and one for PSME.
  const entry = (
    action: 'upload' | 'approve' | 'visibility_change',
    organizationId: string,
    entityId: string,
    at: string,
    actorId: string,
  ) =>
    db.auditLog.create({
      data: {
        action,
        actorId,
        entityType: 'document',
        entityId,
        organizationId,
        metadata: { version: 1 },
        createdAt: new Date(at),
      },
    });
  await entry(
    'upload',
    orgs.jpice.id,
    docs.jpicePublic.id,
    '2026-10-10T00:00:00Z',
    users.officer.id,
  );
  await entry(
    'visibility_change',
    orgs.jpice.id,
    docs.jpicePrivate.id,
    '2026-10-14T03:00:00Z',
    users.officer.id,
  );
  await entry(
    'approve',
    orgs.jpice.id,
    docs.jpicePublic.id,
    '2026-10-12T00:00:00Z',
    users.governor.id,
  );
  await entry(
    'upload',
    orgs.jpice.id,
    docs.jpiceDeleted.id,
    '2026-10-01T00:00:00Z',
    users.officer.id,
  );
  await entry(
    'upload',
    orgs.psme.id,
    docs.psmePublic.id,
    '2026-10-15T00:00:00Z',
    users.governor.id,
  );
  // A login is not activity.
  await db.auditLog.create({
    data: {
      action: 'login',
      actorId: users.officer.id,
      entityType: 'user',
      organizationId: orgs.jpice.id,
    },
  });

  tokenOf.officer = await signFor(users.officer.id);
  tokenOf.governor = await signFor(users.governor.id);
  tokenOf.outsider = await signFor(users.outsider.id);
  tokenOf.admin = await signFor(admin.id);
  tokenOf.pastOfficer = await signFor(pastOfficer.id);
  tokenOf.adviser = await signFor(adviser.id);
  tokenOf.secretary = await signFor(secretary.id);

  const memberships = createMembershipRepository(db);
  app = buildTestApp({
    tokens,
    dashboard: createDashboardService({
      memberships,
      dashboard: createDashboardRepository(db),
      documents: createDocumentRepository(db),
      viewers: createDocumentViewerService({ memberships }),
      storage: { presignGet: (key) => Promise.resolve(`https://storage.test/${key}?signed`) },
      publicUrl: createPublicUrl(TEST_ASSET_BASE_URL),
      now: () => new Date('2026-10-16T00:00:00Z'),
    }),
  });
});

describe('GET /me/dashboard', () => {
  it('401s signed out and with a bad token', async () => {
    await dashboard().expect(401);
    await dashboard('not-a-token').expect(401);
  });

  it('is personal: never cached', async () => {
    const res = await dashboard(tokenOf.officer).expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it("gives an officer their organization's counts, recent documents and own quarantined uploads", async () => {
    const body = await dashboardOf(tokenOf.officer);
    expect(body.memberships).toEqual([
      {
        organizationId: world.orgs.jpice.id,
        role: 'officer',
        isHead: true,
        title: null,
        termEnd: TERM_END.toISOString().slice(0, 10),
      },
    ]);
    expect(body.organizations).toHaveLength(1);
    const [jpice] = body.organizations;
    expect(jpice!.organization).toMatchObject({ id: world.orgs.jpice.id, acronym: 'JPICE' });
    // Available documents by visibility; the deleted document is not counted.
    expect(jpice!.counts).toEqual({
      public: 1,
      members: 1,
      private: 1,
      scanning: 1,
      quarantined: 1,
      archived: 1,
    });
    expect(jpice!.recentDocuments).toHaveLength(5);
    expect(jpice!.recentDocuments.every((d) => d.organization.slug === 'jpice')).toBe(true);
    expect(jpice!.quarantined.map((d) => d.id)).toEqual([world.docs.jpiceQuarantined.id]);
    expect(body).not.toHaveProperty('reviews');
    expect(body.isAdmin).toBe(false);
  });

  it('counts for a member only what members see, and never another officer’s uploads in progress', async () => {
    const [asAdviser] = (await dashboardOf(tokenOf.adviser)).organizations;
    expect(asAdviser!.counts).toEqual({
      public: 1,
      members: 1,
      private: 0,
      scanning: 0,
      quarantined: 0,
      archived: 0,
    });
    const [asSecretary] = (await dashboardOf(tokenOf.secretary)).organizations;
    expect(asSecretary!.counts).toMatchObject({ private: 1, scanning: 0, quarantined: 0 });
    expect(asSecretary!.quarantined).toEqual([]);
  });

  it('lists activity newest first, without logins, old approvals or deleted documents', async () => {
    const [jpice] = (await dashboardOf(tokenOf.officer)).organizations;
    expect(jpice!.activity.map((a) => [a.kind, a.document?.title ?? null])).toEqual([
      ['visibility_change', 'JPICE draft resolution'],
      ['upload', 'JPICE accomplishment report'],
    ]);
    expect(jpice!.activity[0]).toMatchObject({ actorName: 'officer@test.local' });
  });

  it('hides activity about documents the viewer may not see', async () => {
    const [asAdviser] = (await dashboardOf(tokenOf.adviser)).organizations;
    expect(asAdviser!.activity.map((a) => a.document?.title)).toEqual([
      'JPICE accomplishment report',
    ]);
  });

  it("never shows an officer another organization's documents or activity", async () => {
    const res = await dashboard(tokenOf.officer).expect(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(world.orgs.psme.id);
    expect(text).not.toContain('PSME plant visit proposal');
    expect(text).not.toContain(world.orgs.cscCea.id);
  });

  it('gives a CSC governor their own council only: no review queue for the SBOs below', async () => {
    const body = await dashboardOf(tokenOf.governor);
    expect(body.organizations.map((o) => o.organization.acronym)).toEqual(['CSC-CEA']);
    expect(body.organizations[0]!.counts.public).toBe(1);
    expect(JSON.stringify(body)).not.toContain('JPICE');
  });

  it('gives an admin the ISSC and the admin flag', async () => {
    const body = await dashboardOf(tokenOf.admin);
    expect(body.isAdmin).toBe(true);
    expect(body.organizations.map((o) => o.organization.acronym)).toEqual(['ISSC']);
    expect(body.memberships[0]).toMatchObject({ role: 'admin', termEnd: null });
  });

  it('is empty for a user without roles and for an ended term', async () => {
    for (const token of [tokenOf.outsider, tokenOf.pastOfficer]) {
      const body = await dashboardOf(token);
      expect(body).toEqual({ memberships: [], organizations: [], isAdmin: false });
    }
  });
});
