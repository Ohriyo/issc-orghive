import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, manilaDate, type Appeal } from '@orghive/shared';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createMembershipRepository } from '#src/repositories/membership.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { createProjectRepository } from '#src/repositories/project.repository';
import { createAccessService } from '#src/services/access.service';
import { createTokenService } from '#src/services/token.service';
import { testKeys } from './auth-fixtures';
import {
  buildComplianceServices,
  buildComplianceWorld,
  seedProject,
  type Person,
} from './compliance-fixtures';
import { testDb } from './db';
import { buildTestApp } from './helpers';

const db = testDb();
const tokens = createTokenService(testKeys());
let app: ReturnType<typeof buildTestApp>;
let w: Awaited<ReturnType<typeof buildComplianceWorld>>;
let s: ReturnType<typeof buildComplianceServices>;
const tokenOf = {} as Record<Person, string>;
let blockedId: string;
const today = manilaDate(new Date());
const reason = 'Our adviser was on leave, so the proposal could not be signed in time.';

beforeAll(async () => {
  w = await buildComplianceWorld(db);
  s = buildComplianceServices(db);
  for (const [who, userId] of Object.entries(w.ids)) {
    tokenOf[who as Person] = (
      await tokens.sign({ userId, roles: [], isAdmin: false, passwordChangeRequired: false })
    ).token;
  }
  const memberships = createMembershipRepository(db);
  app = buildTestApp({
    tokens,
    access: createAccessService({
      memberships,
      organizations: createOrganizationRepository(db),
      documents: createDocumentRepository(db),
      projects: createProjectRepository(db),
      audit: createAuditLogRepository(db),
    }),
    appeals: s.appeals,
    notifications: s.notifications,
    projects: s.projectService,
  });
  // Created 20 days ago: its proposal was due 6 days ago.
  const project = await seedProject(db, {
    organizationId: w.orgs.jpice.id,
    createdById: w.ids.officer,
    createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
    targetDate: addDays(today, 10),
  });
  blockedId = project.id;
});

function call(method: 'get' | 'post', path: string, who?: Person, body?: object) {
  let req = request(app)[method](`/api/v1${path}`);
  if (who) req = req.set('Authorization', `Bearer ${tokenOf[who]}`);
  return body ? req.send(body) : req;
}

const PDF = { filename: 'letter.pdf', contentType: 'application/pdf', sizeBytes: 2048 };

describe('every appeal and notification route needs a session (401)', () => {
  const routes: ['get' | 'post', string][] = [
    ['get', '/organizations/jpice/compliance'],
    ['post', '/organizations/jpice/appeals'],
    ['post', '/organizations/jpice/appeal-attachments/upload-url'],
    ['post', '/organizations/jpice/appeal-attachments'],
    ['get', '/organizations/jpice/appeal-attachments/0199f0a0-0000-7000-8000-000000000001'],
    ['get', '/projects/0199f0a0-0000-7000-8000-000000000001/appeals'],
    ['get', '/appeals/queue'],
    ['post', '/appeals/0199f0a0-0000-7000-8000-000000000001/decision'],
    [
      'get',
      '/appeals/0199f0a0-0000-7000-8000-000000000001/attachments/0199f0a0-0000-7000-8000-000000000002/download',
    ],
    ['get', '/me/notifications'],
    ['post', '/me/notifications/read-all'],
    ['post', '/me/notifications/0199f0a0-0000-7000-8000-000000000001/read'],
  ];
  for (const [method, path] of routes) {
    it(`${method.toUpperCase()} ${path}`, async () => {
      await call(method, path).expect(401);
    });
  }
});

describe('GET /organizations/:slug/compliance', () => {
  it('shows members the blocked project and who decides (check on read)', async () => {
    const res = await call('get', '/organizations/jpice/compliance', 'adviser').expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body).toMatchObject({
      frozen: false,
      blockedProjects: [{ id: blockedId, pendingAppeal: null }],
      decider: { acronym: 'CSC-CEA' },
    });
  });

  it('403s non-members, including the deciding CSC', async () => {
    await call('get', '/organizations/jpice/compliance', 'psmeOfficer').expect(403);
    await call('get', '/organizations/jpice/compliance', 'governor').expect(403);
  });
});

describe('POST /organizations/:slug/appeals and the decision', () => {
  const body = () => ({ type: 'PROJECT_BLOCK', projectId: blockedId, reason });

  it('403s an adviser, another org’s officer and an admin: only the org’s own officers appeal', async () => {
    for (const who of ['adviser', 'psmeOfficer', 'admin'] as const) {
      await call('post', '/organizations/jpice/appeals', who, body()).expect(403);
    }
  });

  it('400s a reason that is too short', async () => {
    await call('post', '/organizations/jpice/appeals', 'officer', {
      ...body(),
      reason: 'Sorry',
    }).expect(400);
  });

  it('submits, queues for the Governor only, and is decided by them', async () => {
    const res = await call('post', '/organizations/jpice/appeals', 'officer', body()).expect(201);
    const appeal = res.body as Appeal;
    expect(appeal).toMatchObject({ status: 'pending', type: 'PROJECT_BLOCK' });

    const queue = await call('get', '/appeals/queue', 'governor').expect(200);
    expect((queue.body as { items: Appeal[] }).items.map((a) => a.id)).toEqual([appeal.id]);
    const other = await call('get', '/appeals/queue', 'catGovernor').expect(200);
    expect((other.body as { items: Appeal[] }).items).toEqual([]);

    const decision = { decision: 'approve', newDueDate: addDays(today, 7) };
    await call('post', `/appeals/${appeal.id}/decision`, 'catGovernor', decision).expect(403);
    await call('post', `/appeals/${appeal.id}/decision`, 'officer', decision).expect(403);
    // Validation: rejecting needs remarks; approving needs a date after today.
    await call('post', `/appeals/${appeal.id}/decision`, 'governor', {
      decision: 'reject',
    }).expect(400);
    await call('post', `/appeals/${appeal.id}/decision`, 'governor', {
      decision: 'approve',
      newDueDate: today,
    }).expect(400);

    const decided = await call('post', `/appeals/${appeal.id}/decision`, 'governor', decision);
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    expect(decided.body).toMatchObject({ status: 'approved' });

    const history = await call('get', `/projects/${blockedId}/appeals`, 'adviser').expect(200);
    expect((history.body as { items: Appeal[] }).items).toEqual([
      expect.objectContaining({ id: appeal.id, status: 'approved' }),
    ]);
    await call('get', `/projects/${blockedId}/appeals`, 'psmeOfficer').expect(403);

    const decidedQueue = await call('get', '/appeals/queue?status=decided', 'governor').expect(200);
    expect((decidedQueue.body as { items: Appeal[] }).items).toHaveLength(1);
  });

  it('404s a decision on an unknown appeal', async () => {
    await call('post', '/appeals/0199f0a0-0000-7000-8000-000000000009/decision', 'governor', {
      decision: 'reject',
      remarks: 'Not enough detail here.',
    }).expect(404);
  });
});

describe('appeal attachments', () => {
  it('only the org’s own officers upload; others get 403', async () => {
    for (const who of ['adviser', 'psmeOfficer', 'admin', 'governor'] as const) {
      await call('post', '/organizations/jpice/appeal-attachments/upload-url', who, PDF).expect(
        403,
      );
    }
  });

  it('issues a URL, claims the upload as a pending attachment, and reports its scan', async () => {
    const url = await call(
      'post',
      '/organizations/jpice/appeal-attachments/upload-url',
      'officer',
      PDF,
    ).expect(201);
    const { uploadKey } = url.body as { uploadKey: string };
    const created = await call('post', '/organizations/jpice/appeal-attachments', 'officer', {
      uploadKey,
    }).expect(201);
    const id = (created.body as { id: string }).id;
    expect(created.body).toMatchObject({ scanStatus: 'pending', filename: 'letter.pdf' });
    await s.attachments.processAttachment(id);
    const polled = await call(
      'get',
      `/organizations/jpice/appeal-attachments/${id}`,
      'officer',
    ).expect(200);
    expect(polled.body).toMatchObject({ scanStatus: 'clean' });
    await call('get', `/organizations/psme/appeal-attachments/${id}`, 'psmeOfficer').expect(404);
  });
});

describe('/me/notifications', () => {
  it('lists the user’s own notifications and marks them read', async () => {
    const list = await call('get', '/me/notifications', 'governor').expect(200);
    expect(list.headers['cache-control']).toBe('private, no-store');
    const { items, unreadCount } = list.body as {
      items: { id: string; kind: string }[];
      unreadCount: number;
    };
    expect(items.some((n) => n.kind === 'appeal_submitted')).toBe(true);
    expect(unreadCount).toBeGreaterThan(0);

    // Someone else's notification: 404.
    await call('post', `/me/notifications/${items[0]!.id}/read`, 'officer').expect(404);
    await call('post', `/me/notifications/${items[0]!.id}/read`, 'governor').expect(204);
    await call('post', '/me/notifications/read-all', 'governor').expect(204);
    const after = await call('get', '/me/notifications', 'governor').expect(200);
    expect((after.body as { unreadCount: number }).unreadCount).toBe(0);
  });
});
