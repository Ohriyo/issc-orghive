import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { dashboardResponseSchema, type DashboardResponse } from '@orghive/shared';
import { createPublicUrl } from '#src/lib/public-url';
import { createDashboardRepository } from '#src/repositories/dashboard.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createProjectRepository } from '#src/repositories/project.repository';
import { createAccountRepository } from '#src/repositories/account.repository';
import { createDashboardService } from '#src/services/dashboard.service';
import { createDocumentViewerService } from '#src/services/document-viewer.service';
import { createTokenService } from '#src/services/token.service';
import { testKeys } from './auth-fixtures';
import { buildWorld, resetDb, TERM_END, testDb, type World } from './db';
import { buildTestApp, TEST_ASSET_BASE_URL } from './helpers';

const db = testDb();
const tokens = createTokenService(testKeys());

let world: World;
let app: ReturnType<typeof buildTestApp>;
const tokenOf = {} as Record<'officer' | 'governor' | 'outsider' | 'admin' | 'pastAccount', string>;

async function signFor(userId: string) {
  const { token } = await tokens.sign({
    userId,
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

  // A former JPICE account, deactivated when a new one replaced it: acts for nobody.
  const pastAccount = await db.user.create({
    data: {
      email: 'past.jpice@test.local',
      name: 'Past JPICE',
      passwordHash: 'x',
      organizationId: orgs.jpice.id,
      disabledAt: new Date('2026-08-01'),
    },
  });

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
  tokenOf.admin = await signFor(users.issc.id);
  tokenOf.pastAccount = await signFor(pastAccount.id);

  const accounts = createAccountRepository(db);
  app = buildTestApp({
    tokens,
    dashboard: createDashboardService({
      accounts,
      dashboard: createDashboardRepository(db),
      documents: createDocumentRepository(db),
      viewers: createDocumentViewerService({ accounts }),
      projects: createProjectRepository(db),
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

  it("gives the account its organization's counts, recent documents and quarantined uploads", async () => {
    const body = await dashboardOf(tokenOf.officer);
    expect(body.term).toEqual({
      officerInCharge: {
        name: 'jpice officer',
        position: 'President',
        email: 'officer.jpice@test.local',
      },
      termEnd: TERM_END.toISOString().slice(0, 10),
    });
    expect(body.organizations).toHaveLength(1);
    const [jpice] = body.organizations;
    expect(jpice!.organization).toMatchObject({ id: world.orgs.jpice.id, acronym: 'JPICE' });
    // Available documents by visibility; the deleted document is not counted.
    expect(jpice!.counts).toEqual({
      public: 1,
      governing: 1,
      private: 1,
      scanning: 1,
      quarantined: 1,
      archived: 1,
    });
    expect(jpice!.recentDocuments).toHaveLength(5);
    expect(jpice!.recentDocuments.every((d) => d.organization.slug === 'jpice')).toBe(true);
    expect(jpice!.quarantined.map((d) => d.id)).toEqual([world.docs.jpiceQuarantined.id]);
    expect(body).not.toHaveProperty('reviews');
    // An SBO decides nothing and sees no compliance overview.
    expect(body).toMatchObject({ isIssc: false, canSeeCompliance: false, decidesAppeals: false });
  });

  it('lists activity newest first, without logins, old approvals or deleted documents', async () => {
    const [jpice] = (await dashboardOf(tokenOf.officer)).organizations;
    expect(jpice!.activity.map((a) => [a.kind, a.document?.title ?? null])).toEqual([
      ['visibility_change', 'JPICE draft resolution'],
      ['upload', 'JPICE accomplishment report'],
    ]);
    expect(jpice!.activity[0]).toMatchObject({ actorName: 'jpice' });
  });

  it("never shows an officer another organization's documents or activity", async () => {
    const res = await dashboard(tokenOf.officer).expect(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(world.orgs.psme.id);
    expect(text).not.toContain('PSME plant visit proposal');
    expect(text).not.toContain(world.orgs.cscCea.id);
  });

  it('gives a CSC account its own council only, and links to appeals and compliance', async () => {
    const body = await dashboardOf(tokenOf.governor);
    expect(body.organizations.map((o) => o.organization.acronym)).toEqual(['CSC-CEA']);
    expect(body.organizations[0]!.counts.public).toBe(1);
    expect(JSON.stringify(body)).not.toContain('JPICE');
    expect(body).toMatchObject({ isIssc: false, canSeeCompliance: true, decidesAppeals: true });
  });

  it('gives the ISSC account the ISSC and the admin flag', async () => {
    const body = await dashboardOf(tokenOf.admin);
    expect(body).toMatchObject({ isIssc: true, canSeeCompliance: true, decidesAppeals: true });
    expect(body.organizations.map((o) => o.organization.acronym)).toEqual(['ISSC']);
    expect(body.term?.officerInCharge.name).toBe('issc officer');
  });

  it('is empty for an account without an organization and for a deactivated one', async () => {
    for (const token of [tokenOf.outsider, tokenOf.pastAccount]) {
      expect(await dashboardOf(token)).toEqual({
        term: null,
        organizations: [],
        isIssc: false,
        canSeeCompliance: false,
        decidesAppeals: false,
      });
    }
  });
});
