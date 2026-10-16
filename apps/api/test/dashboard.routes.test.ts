import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { dashboardResponseSchema, type DashboardResponse } from '@orghive/shared';
import { createPublicUrl } from '#src/lib/public-url';
import { createDashboardRepository } from '#src/repositories/dashboard.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createMembershipRepository } from '#src/repositories/membership.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
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
const tokenOf = {} as Record<'officer' | 'governor' | 'outsider' | 'admin' | 'pastOfficer', string>;

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

  // The governor rejected JPICE's report with a remark.
  await db.approval.create({
    data: {
      documentId: docs.jpiceRejected.id,
      versionId: docs.jpiceRejected.currentVersionId!,
      approverId: users.governor.id,
      decision: 'rejected',
      comment: 'Attach the signed attendance sheet.',
      decidedAt: new Date('2026-10-14T03:00:00Z'),
    },
  });
  // Activity: two JPICE entries, one about a since-deleted document, and one for PSME.
  const entry = (
    action: 'upload' | 'reject' | 'approve',
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
    docs.jpiceRejected.id,
    '2026-10-10T00:00:00Z',
    users.officer.id,
  );
  await entry(
    'reject',
    orgs.jpice.id,
    docs.jpiceRejected.id,
    '2026-10-14T03:00:00Z',
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
    docs.psmePending.id,
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

  const memberships = createMembershipRepository(db);
  const organizations = createOrganizationRepository(db);
  app = buildTestApp({
    tokens,
    dashboard: createDashboardService({
      memberships,
      dashboard: createDashboardRepository(db),
      documents: createDocumentRepository(db),
      viewers: createDocumentViewerService({ memberships, organizations }),
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

  it("gives an officer their organization's counts, recent documents and remarks", async () => {
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
    // The deleted document is not counted.
    expect(jpice!.counts).toEqual({ draft: 1, pending: 1, approved: 1, rejected: 1, archived: 1 });
    expect(jpice!.recentDocuments).toHaveLength(5);
    expect(jpice!.recentDocuments.every((d) => d.organization.slug === 'jpice')).toBe(true);
    expect(jpice!.needsRevision).toEqual([
      expect.objectContaining({
        document: expect.objectContaining({ id: world.docs.jpiceRejected.id }) as unknown,
        remark: 'Attach the signed attendance sheet.',
        reviewerName: 'governor@test.local',
        decidedAt: '2026-10-14T03:00:00.000Z',
      }),
    ]);
    expect(body.reviews).toBeNull();
    expect(body.isAdmin).toBe(false);
  });

  it('lists uploads and decisions newest first, without logins or deleted documents', async () => {
    const [jpice] = (await dashboardOf(tokenOf.officer)).organizations;
    expect(jpice!.activity.map((a) => [a.kind, a.document?.title ?? null])).toEqual([
      ['reject', 'JPICE week narrative report'],
      ['upload', 'JPICE week narrative report'],
    ]);
    expect(jpice!.activity[0]).toMatchObject({ actorName: 'governor@test.local', version: 1 });
  });

  it("never shows an officer another organization's documents or activity", async () => {
    const res = await dashboard(tokenOf.officer).expect(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(world.orgs.psme.id);
    expect(text).not.toContain('PSME plant visit proposal');
    expect(text).not.toContain(world.orgs.cscCea.id);
  });

  it('gives a CSC governor their council plus a count of SBO documents to review', async () => {
    const body = await dashboardOf(tokenOf.governor);
    expect(body.organizations.map((o) => o.organization.acronym)).toEqual(['CSC-CEA']);
    expect(body.organizations[0]!.counts.pending).toBe(1);
    // JPICE and PSME each have one pending document with a clean file.
    expect(body.reviews).toEqual({ pending: 2, organizations: 2 });
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
      expect(body).toEqual({ memberships: [], organizations: [], reviews: null, isAdmin: false });
    }
  });
});
