import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { memoryCache } from '#src/lib/cache';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createDocumentTypeRepository } from '#src/repositories/document-type.repository';
import { createMembershipRepository } from '#src/repositories/membership.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { createAccessService } from '#src/services/access.service';
import { createDocumentService } from '#src/services/document.service';
import { createDocumentViewerService } from '#src/services/document-viewer.service';
import { createTokenService } from '#src/services/token.service';
import { testKeys } from './auth-fixtures';
import { buildWorld, createTestDocument, resetDb, testDb, type World } from './db';
import { buildTestApp } from './helpers';

const db = testDb();
const tokens = createTokenService(testKeys());

type Role = 'anonymous' | 'student' | 'jpiceOfficer' | 'iecepOfficer' | 'ceaAdviser' | 'admin';
const ROLES: Role[] = [
  'anonymous',
  'student',
  'jpiceOfficer',
  'iecepOfficer',
  'ceaAdviser',
  'admin',
];

let world: World;
let iecep: { id: string; slug: string };
let app: ReturnType<typeof buildTestApp>;
const userIds = {} as Record<Exclude<Role, 'anonymous'> | 'ceaGovernor' | 'pastJpiceOfficer', string>;
const tokenOf = {} as Record<Exclude<Role, 'anonymous'> | 'ceaGovernor' | 'pastJpiceOfficer', string>;

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function signFor(userId: string, claims: { isAdmin?: boolean; roles?: never[] } = {}) {
  const { token } = await tokens.sign({
    userId,
    roles: claims.roles ?? [],
    isAdmin: claims.isAdmin ?? false,
    passwordChangeRequired: false,
  });
  return token;
}

beforeAll(async () => {
  await resetDb(db);
  world = await buildWorld(db);
  iecep = await db.organization.create({
    data: {
      type: 'SBO',
      slug: 'iecep',
      acronym: 'IECEP',
      name: 'Institute of Electronics Engineers of the Philippines',
      parentId: world.orgs.cscCea.id,
      collegeId: world.colleges.cea.id,
    },
  });

  // Terms relative to today, so the matrix does not expire with the calendar.
  const current = { termStart: daysFromNow(-60), termEnd: daysFromNow(300) };
  const people: [keyof typeof userIds, string | null, 'officer' | 'adviser' | 'admin', object][] =
    [
      ['student', null, 'officer', {}],
      ['jpiceOfficer', world.orgs.jpice.id, 'officer', current],
      ['iecepOfficer', iecep.id, 'officer', current],
      ['ceaAdviser', world.orgs.cscCea.id, 'adviser', current],
      ['admin', world.orgs.issc.id, 'admin', { termStart: daysFromNow(-60), termEnd: null }],
      ['ceaGovernor', world.orgs.cscCea.id, 'officer', { ...current, isHead: true }],
      [
        'pastJpiceOfficer',
        world.orgs.jpice.id,
        'officer',
        { termStart: daysFromNow(-400), termEnd: daysFromNow(-35) },
      ],
    ];
  for (const [key, orgId, role, extra] of people) {
    const user = await db.user.create({
      data: { email: `${key.toLowerCase()}@matrix.test`, name: key, passwordHash: 'x' },
    });
    if (orgId) {
      await db.membership.create({
        data: { userId: user.id, organizationId: orgId, role, ...extra } as never,
      });
    }
    userIds[key] = user.id;
    tokenOf[key] = await signFor(user.id);
  }

  const memberships = createMembershipRepository(db);
  const organizations = createOrganizationRepository(db);
  const documents = createDocumentRepository(db);
  const audit = createAuditLogRepository(db);
  const viewers = createDocumentViewerService({ memberships, organizations });
  app = buildTestApp({
    tokens,
    documents: createDocumentService({
      documents,
      documentTypes: createDocumentTypeRepository(db),
      organizations,
      viewers,
      audit,
      cache: memoryCache(),
    }),
    access: createAccessService({ memberships, organizations, documents, viewers, audit }),
  });
});

type Target = 'draft' | 'pending' | 'publicApproved' | 'privateApproved';

/** Fresh IECEP documents for one case, so cases never depend on each other. */
async function iecepDocument(target: Target, orgId = iecep.id) {
  const status = target === 'draft' ? 'draft' : target === 'pending' ? 'pending' : 'approved';
  return createTestDocument(db, {
    organizationId: orgId,
    typeId: world.types.proposal.id,
    title: `IECEP ${target} ${crypto.randomUUID()}`,
    status,
    createdById: userIds.iecepOfficer,
    visibility: target === 'privateApproved' ? 'private' : 'public',
  });
}

function call(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  token?: string,
  body?: object,
) {
  let req = request(app)[method](`/api/v1${path}`);
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  return body ? req.send(body) : req;
}

interface Action {
  name: string;
  target?: Target;
  run: (token: string | undefined, documentId: string) => ReturnType<typeof call>;
  expected: Record<Role, number>;
}

const createBody = () => ({
  typeId: world.types.proposal.id,
  title: 'Matrix proposal',
  academicYear: '2026-2027',
});

/**
 * Every document action on IECEP's Paperworks. Reads of a document the user may not see
 * are 404 (its existence is not revealed); writes are 401 signed out and 403 without the
 * role. The JPICE officer is a sibling SBO's officer and must get nowhere.
 */
const ACTIONS: Action[] = [
  {
    name: 'list IECEP documents',
    run: (t) => call('get', '/organizations/iecep/documents', t),
    expected: {
      anonymous: 200,
      student: 200,
      jpiceOfficer: 200,
      iecepOfficer: 200,
      ceaAdviser: 200,
      admin: 200,
    },
  },
  {
    name: 'read a public approved document',
    target: 'publicApproved',
    run: (t, id) => call('get', `/documents/${id}`, t),
    expected: {
      anonymous: 200,
      student: 200,
      jpiceOfficer: 200,
      iecepOfficer: 200,
      ceaAdviser: 200,
      admin: 200,
    },
  },
  {
    name: 'read a private approved document',
    target: 'privateApproved',
    run: (t, id) => call('get', `/documents/${id}`, t),
    expected: {
      anonymous: 404,
      student: 404,
      jpiceOfficer: 404,
      iecepOfficer: 200,
      ceaAdviser: 404,
      admin: 200,
    },
  },
  {
    name: 'read a draft',
    target: 'draft',
    run: (t, id) => call('get', `/documents/${id}`, t),
    expected: {
      anonymous: 404,
      student: 404,
      jpiceOfficer: 404,
      iecepOfficer: 200,
      ceaAdviser: 404,
      admin: 200,
    },
  },
  {
    name: 'create a document',
    run: (t) => call('post', '/organizations/iecep/documents', t, createBody()),
    expected: {
      anonymous: 401,
      student: 403,
      jpiceOfficer: 403,
      iecepOfficer: 201,
      ceaAdviser: 403,
      admin: 201,
    },
  },
  {
    name: 'edit a draft',
    target: 'draft',
    run: (t, id) => call('patch', `/documents/${id}`, t, { title: 'Edited title' }),
    expected: {
      anonymous: 401,
      student: 403,
      jpiceOfficer: 403,
      iecepOfficer: 200,
      ceaAdviser: 403,
      admin: 200,
    },
  },
  {
    name: 'submit a draft',
    target: 'draft',
    run: (t, id) => call('post', `/documents/${id}/submit`, t),
    expected: {
      anonymous: 401,
      student: 403,
      jpiceOfficer: 403,
      iecepOfficer: 200,
      ceaAdviser: 403,
      admin: 200,
    },
  },
  {
    name: 'approve a pending document',
    target: 'pending',
    run: (t, id) => call('post', `/documents/${id}/approve`, t),
    expected: {
      anonymous: 401,
      student: 403,
      jpiceOfficer: 403,
      iecepOfficer: 403,
      ceaAdviser: 403,
      admin: 200,
    },
  },
  {
    name: 'reject a pending document',
    target: 'pending',
    run: (t, id) => call('post', `/documents/${id}/reject`, t, { comment: 'Incomplete' }),
    expected: {
      anonymous: 401,
      student: 403,
      jpiceOfficer: 403,
      iecepOfficer: 403,
      ceaAdviser: 403,
      admin: 200,
    },
  },
  {
    name: 'delete a document',
    target: 'publicApproved',
    run: (t, id) => call('delete', `/documents/${id}`, t),
    expected: {
      anonymous: 401,
      student: 403,
      jpiceOfficer: 403,
      iecepOfficer: 204,
      ceaAdviser: 403,
      admin: 204,
    },
  },
];

const CASES = ACTIONS.flatMap((action) =>
  ROLES.map((role) => ({ action, role, status: action.expected[role] })),
);

describe('document authorization matrix (IECEP documents)', () => {
  it.each(CASES)('$action.name as $role -> $status', async ({ action, role, status }) => {
    const doc = action.target ? await iecepDocument(action.target) : undefined;
    const token = role === 'anonymous' ? undefined : tokenOf[role];
    const res = await action.run(token, doc?.id ?? '');
    expect(res.status, JSON.stringify(res.body)).toBe(status);
  });
});

describe('document authorization: cross-organization and term checks', () => {
  it('a JPICE officer can act on JPICE documents but not on the same action for IECEP', async () => {
    const jpiceDraft = await iecepDocument('draft', world.orgs.jpice.id);
    const iecepDraft = await iecepDocument('draft');
    const t = tokenOf.jpiceOfficer;
    await call('patch', `/documents/${jpiceDraft.id}`, t, { title: 'Own draft' }).expect(200);
    await call('patch', `/documents/${iecepDraft.id}`, t, { title: 'Not mine' }).expect(403);
    await call('delete', `/documents/${iecepDraft.id}`, t).expect(403);
    const after = await db.document.findUniqueOrThrow({ where: { id: iecepDraft.id } });
    expect(after.title).not.toBe('Not mine');
    expect(after.deletedAt).toBeNull();
  });

  it('cannot move a document to another organization through the body', async () => {
    await call('post', '/organizations/jpice/documents', tokenOf.jpiceOfficer, {
      ...createBody(),
      organizationId: iecep.id,
    }).expect(400);
    await call('post', '/organizations/jpice/documents', tokenOf.jpiceOfficer, {
      ...createBody(),
      status: 'approved',
    }).expect(400);
  });

  it('ignores roles claimed in the token: memberships come from the database', async () => {
    const forged = await signFor(userIds.jpiceOfficer, { isAdmin: true });
    const draft = await iecepDocument('draft');
    await call('patch', `/documents/${draft.id}`, forged, { title: 'Claimed admin' }).expect(403);
  });

  it('grants nothing to a membership whose term has ended', async () => {
    const draft = await iecepDocument('draft', world.orgs.jpice.id);
    await call('patch', `/documents/${draft.id}`, tokenOf.pastJpiceOfficer, {
      title: 'Old officer',
    }).expect(403);
  });

  it('lets the CEA Governor approve IECEP documents and records the approval', async () => {
    const pending = await iecepDocument('pending');
    const res = await call('post', `/documents/${pending.id}/approve`, tokenOf.ceaGovernor).expect(
      200,
    );
    expect(res.body).toMatchObject({ status: 'approved' });
    expect(await db.approval.count({ where: { documentId: pending.id } })).toBe(1);
    expect(
      await db.auditLog.count({
        where: { action: 'approve', entityId: pending.id, actorId: userIds.ceaGovernor },
      }),
    ).toBe(1);
  });

  it('audits an admin override, but not an approver acting in their own right', async () => {
    const draft = await iecepDocument('draft');
    await call('patch', `/documents/${draft.id}`, tokenOf.admin, { title: 'Admin edit' }).expect(
      200,
    );
    const overrides = await db.auditLog.findMany({
      where: { action: 'admin_override', actorId: userIds.admin, organizationId: iecep.id },
    });
    expect(overrides.length).toBeGreaterThan(0);
    expect(overrides.at(-1)!.metadata).toEqual({
      required: 'role:officer',
      method: 'PATCH',
      route: '/api/v1/documents/:documentId',
    });

    const pending = await iecepDocument('pending');
    const res = await call('post', `/documents/${pending.id}/reject`, tokenOf.ceaGovernor).expect(
      200,
    );
    expect(res.body).toMatchObject({ id: pending.id, status: 'rejected' });
    expect(
      await db.auditLog.count({ where: { action: 'admin_override', actorId: userIds.ceaGovernor } }),
    ).toBe(0);
  });

  it('404s writes on unknown or deleted documents for authorized users too', async () => {
    await call('patch', `/documents/${crypto.randomUUID()}`, tokenOf.admin, { title: 'X' }).expect(
      404,
    );
    const deleted = await iecepDocument('draft');
    await call('delete', `/documents/${deleted.id}`, tokenOf.iecepOfficer).expect(204);
    await call('delete', `/documents/${deleted.id}`, tokenOf.iecepOfficer).expect(404);
  });
});

describe('document reads: visibility and caching headers', () => {
  it('lists only what each viewer may see', async () => {
    const pub = await iecepDocument('publicApproved');
    const priv = await iecepDocument('privateApproved');
    const members = await createTestDocument(db, {
      organizationId: iecep.id,
      typeId: world.types.proposal.id,
      title: `IECEP members ${crypto.randomUUID()}`,
      status: 'approved',
      createdById: userIds.iecepOfficer,
      visibility: 'members',
    });
    const ids = async (token?: string) =>
      ((await call('get', '/organizations/iecep/documents?limit=100', token).expect(200)).body as {
        items: { id: string }[];
      }).items.map((d) => d.id);

    const anon = await ids();
    expect(anon).toContain(pub.id);
    expect(anon).not.toContain(members.id);
    expect(anon).not.toContain(priv.id);

    const student = await ids(tokenOf.student);
    expect(student).toContain(members.id);
    expect(student).not.toContain(priv.id);

    expect(await ids(tokenOf.iecepOfficer)).toContain(priv.id);
    expect(await ids(tokenOf.jpiceOfficer)).not.toContain(priv.id);
  });

  it('sends public Cache-Control only to signed-out readers', async () => {
    const anon = await call('get', '/organizations/iecep/documents').expect(200);
    expect(anon.headers['cache-control']).toBe('public, max-age=60, stale-while-revalidate=300');
    expect(anon.headers.vary).toMatch(/Authorization/i);
    const signedIn = await call('get', '/organizations/iecep/documents', tokenOf.student).expect(
      200,
    );
    expect(signedIn.headers['cache-control']).toBe('private, no-store');
  });

  it('401s a read with an invalid token instead of serving the public view', async () => {
    await call('get', '/organizations/iecep/documents', 'abc.def.ghi').expect(401);
  });
});
