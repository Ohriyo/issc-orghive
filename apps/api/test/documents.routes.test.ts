import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { memoryCache } from '#src/lib/cache';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createDocumentTypeRepository } from '#src/repositories/document-type.repository';
import { createMembershipRepository } from '#src/repositories/membership.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { createProjectRepository } from '#src/repositories/project.repository';
import { createAccessService } from '#src/services/access.service';
import { createDocumentService } from '#src/services/document.service';
import { createDocumentViewerService } from '#src/services/document-viewer.service';
import { createTokenService } from '#src/services/token.service';
import { createUploadService } from '#src/services/upload.service';
import type { Storage } from '#src/lib/storage';
import { createUploadIntentRepository } from '#src/repositories/upload-intent.repository';
import { testKeys } from './auth-fixtures';
import { buildWorld, createTestDocument, resetDb, testDb, type World } from './db';
import { buildTestApp } from './helpers';

const db = testDb();
const tokens = createTokenService(testKeys());

/**
 * Storage stand-in: an upload "exists" once its intent exists (as if the browser's PUT
 * succeeded), with exactly the declared size and type. Signed URLs are fake but shaped.
 */
const storage: Storage = {
  presignPut: (key) =>
    Promise.resolve({ url: `https://storage.test/${key}?put`, headers: { 'Content-Type': 'x' } }),
  presignGet: (key, file) =>
    Promise.resolve(`https://storage.test/${key}?get&disposition=${file.disposition}`),
  head: async (key) => {
    const intent = await db.uploadIntent.findUnique({ where: { key } });
    return intent ? { sizeBytes: intent.sizeBytes, contentType: intent.contentType } : null;
  },
  read: () => Promise.reject(new Error('not used')),
  put: () => Promise.resolve(),
  move: () => Promise.resolve(),
  delete: () => Promise.resolve(),
};
const queued: string[] = [];
const queue = {
  enqueueProcessing: (versionId: string) => {
    queued.push(versionId);
    return Promise.resolve();
  },
};

type Role =
  | 'anonymous'
  | 'student'
  | 'jpiceOfficer'
  | 'iecepOfficer'
  | 'iecepMember'
  | 'ceaAdviser'
  | 'admin';
const ROLES: Role[] = [
  'anonymous',
  'student',
  'jpiceOfficer',
  'iecepOfficer',
  'iecepMember',
  'ceaAdviser',
  'admin',
];
type Person = Exclude<Role, 'anonymous'> | 'ceaGovernor' | 'iecepSecretary' | 'pastJpiceOfficer';

let world: World;
let iecep: { id: string; slug: string };
let app: ReturnType<typeof buildTestApp>;
const userIds = {} as Record<Person, string>;
const tokenOf = {} as Record<Person, string>;

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
  const people: [Person, string | null, 'officer' | 'adviser' | 'admin', object][] = [
    ['student', null, 'officer', {}],
    ['jpiceOfficer', world.orgs.jpice.id, 'officer', current],
    ['iecepOfficer', iecep.id, 'officer', current],
    // A member of IECEP who is not an officer: sees members-only files, not private ones.
    ['iecepMember', iecep.id, 'adviser', current],
    ['iecepSecretary', iecep.id, 'officer', current],
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
  const viewers = createDocumentViewerService({ memberships });
  const uploads = createUploadService({ intents: createUploadIntentRepository(db), storage });
  app = buildTestApp({
    tokens,
    uploads,
    documents: createDocumentService({
      documents,
      documentTypes: createDocumentTypeRepository(db),
      organizations,
      viewers,
      uploads,
      queue,
      storage,
      audit,
      cache: memoryCache(),
    }),
    access: createAccessService({
      memberships,
      organizations,
      documents,
      projects: createProjectRepository(db),
      audit,
    }),
  });
});

type Target = 'public' | 'members' | 'private' | 'scanning' | 'archived';

/** A fresh IECEP document uploaded by its officer, so cases never depend on each other. */
async function iecepDocument(target: Target, orgId = iecep.id) {
  const status =
    target === 'scanning' ? 'scanning' : target === 'archived' ? 'archived' : 'available';
  const visibility = target === 'members' || target === 'private' ? target : 'public';
  return createTestDocument(db, {
    organizationId: orgId,
    typeId: world.types.proposal.id,
    title: `IECEP ${target} ${crypto.randomUUID()}`,
    status,
    createdById: userIds.iecepOfficer,
    visibility,
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
  run: (token: string | undefined, documentId: string, role: Role) => PromiseLike<request.Response>;
  expected: Record<Role, number>;
}

/** An upload URL this user was given for this organization (the PUT is assumed done). */
async function uploadFor(userId: string, orgId: string, sizeBytes = 1000) {
  const key = `uploads/${orgId}/${crypto.randomUUID()}`;
  await db.uploadIntent.create({
    data: {
      key,
      organizationId: orgId,
      userId,
      originalFilename: 'proposal.pdf',
      contentType: 'application/pdf',
      sizeBytes,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    },
  });
  return key;
}

const createBody = (uploadKey = `uploads/${crypto.randomUUID()}/${crypto.randomUUID()}`) => ({
  typeId: world.types.proposal.id,
  title: 'Matrix proposal',
  academicYear: '2026-2027',
  uploadKey,
});

/** The create body for whoever is acting: their own upload for IECEP. */
async function createBodyFor(role: Role) {
  if (role === 'anonymous') return createBody();
  return createBody(await uploadFor(userIds[role], iecep.id));
}

const NOT_FOUND_EXCEPT = (seen: Partial<Record<Role, number>>): Record<Role, number> => ({
  anonymous: 404,
  student: 404,
  jpiceOfficer: 404,
  iecepOfficer: 404,
  iecepMember: 404,
  ceaAdviser: 404,
  admin: 404,
  ...seen,
});

/** Writes: 401 signed out, 403 without the role; IECEP's officer and (by override) admins pass. */
const OFFICER_WRITE = (ok: number): Record<Role, number> => ({
  anonymous: 401,
  student: 403,
  jpiceOfficer: 403,
  iecepOfficer: ok,
  iecepMember: 403,
  ceaAdviser: 403,
  admin: ok,
});

/**
 * Every document action on IECEP's Paperworks. Reads of a document the user may not see
 * are 404 (its existence is not revealed); writes are 401 signed out and 403 without the
 * role. The JPICE officer is a sibling SBO's officer and must get nowhere; the CEA adviser
 * belongs to the parent council, which reviews nothing.
 */
const ACTIONS: Action[] = [
  {
    name: 'list IECEP documents',
    run: (t) => call('get', '/organizations/iecep/documents', t),
    expected: NOT_FOUND_EXCEPT(Object.fromEntries(ROLES.map((r) => [r, 200]))),
  },
  {
    name: 'read a public document',
    target: 'public',
    run: (t, id) => call('get', `/documents/${id}`, t),
    expected: NOT_FOUND_EXCEPT(Object.fromEntries(ROLES.map((r) => [r, 200]))),
  },
  {
    name: 'read a members-only document',
    target: 'members',
    run: (t, id) => call('get', `/documents/${id}`, t),
    expected: NOT_FOUND_EXCEPT({ iecepOfficer: 200, iecepMember: 200, admin: 200 }),
  },
  {
    name: 'read a private document',
    target: 'private',
    run: (t, id) => call('get', `/documents/${id}`, t),
    expected: NOT_FOUND_EXCEPT({ iecepOfficer: 200, admin: 200 }),
  },
  {
    name: 'read a document still being scanned (uploader only)',
    target: 'scanning',
    run: (t, id) => call('get', `/documents/${id}`, t),
    expected: NOT_FOUND_EXCEPT({ iecepOfficer: 200 }),
  },
  {
    name: 'read an archived document',
    target: 'archived',
    run: (t, id) => call('get', `/documents/${id}`, t),
    expected: NOT_FOUND_EXCEPT({ iecepOfficer: 200, admin: 200 }),
  },
  {
    name: 'create a document',
    run: async (t, _id, role) =>
      call('post', '/organizations/iecep/documents', t, await createBodyFor(role)),
    expected: OFFICER_WRITE(201),
  },
  {
    name: 'edit details',
    target: 'private',
    run: (t, id) => call('patch', `/documents/${id}`, t, { title: 'Edited title' }),
    expected: OFFICER_WRITE(200),
  },
  {
    name: 'change visibility (the organization only, never admins)',
    target: 'private',
    run: (t, id) => call('patch', `/documents/${id}/visibility`, t, { visibility: 'public' }),
    expected: { ...OFFICER_WRITE(200), admin: 403 },
  },
  {
    name: 'archive an available document',
    target: 'public',
    run: (t, id) => call('post', `/documents/${id}/archive`, t),
    expected: OFFICER_WRITE(200),
  },
  {
    name: 'restore an archived document',
    target: 'archived',
    run: (t, id) => call('post', `/documents/${id}/restore`, t),
    expected: OFFICER_WRITE(200),
  },
  {
    name: 'delete a document',
    target: 'public',
    run: (t, id) => call('delete', `/documents/${id}`, t),
    expected: OFFICER_WRITE(204),
  },
];

const CASES = ACTIONS.flatMap((action) =>
  ROLES.map((role) => ({ action, role, status: action.expected[role] })),
);

describe('document authorization matrix (IECEP documents)', () => {
  it.each(CASES)('$action.name as $role -> $status', async ({ action, role, status }) => {
    const doc = action.target ? await iecepDocument(action.target) : undefined;
    const token = role === 'anonymous' ? undefined : tokenOf[role];
    const res = await action.run(token, doc?.id ?? '', role);
    expect(res.status, JSON.stringify(res.body)).toBe(status);
  });
});

describe('visibility, enforced by the repository for every reader', () => {
  let docs: Record<'public' | 'members' | 'private', { id: string }>;

  beforeAll(async () => {
    docs = {
      public: await iecepDocument('public'),
      members: await iecepDocument('members'),
      private: await iecepDocument('private'),
    };
  });

  /** Which of the three test documents this reader gets, from the list, search and detail. */
  async function seenBy(token?: string) {
    const listed = (
      (await call('get', '/organizations/iecep/documents?limit=100', token).expect(200)).body as {
        items: { id: string }[];
      }
    ).items.map((d) => d.id);
    const seen: string[] = [];
    for (const [name, doc] of Object.entries(docs)) {
      const detail = await call('get', `/documents/${doc.id}`, token);
      expect(detail.status === 200, `detail of ${name}`).toBe(listed.includes(doc.id));
      if (detail.status === 200) seen.push(name);
    }
    return seen;
  }

  it('shows a visitor only public files', async () => {
    expect(await seenBy()).toEqual(['public']);
  });

  it('shows a member of the organization public and members-only files', async () => {
    expect(await seenBy(tokenOf.iecepMember)).toEqual(['public', 'members']);
  });

  it('shows an officer of the organization all three', async () => {
    expect(await seenBy(tokenOf.iecepOfficer)).toEqual(['public', 'members', 'private']);
  });

  it('shows another organization’s officer only public files', async () => {
    expect(await seenBy(tokenOf.jpiceOfficer)).toEqual(['public']);
  });

  it('gives the parent council’s head no review access (no organization reviews another)', async () => {
    expect(await seenBy(tokenOf.ceaGovernor)).toEqual(['public']);
  });

  it('shows a signed-in user with no membership only public files', async () => {
    expect(await seenBy(tokenOf.student)).toEqual(['public']);
  });

  it('shows an admin all three, auditing each view of one they see only as an admin', async () => {
    const before = await db.auditLog.count({
      where: { action: 'admin_override', actorId: userIds.admin, entityType: 'document' },
    });
    expect(await seenBy(tokenOf.admin)).toEqual(['public', 'members', 'private']);
    const entries = await db.auditLog.findMany({
      where: { action: 'admin_override', actorId: userIds.admin, entityType: 'document' },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries.length - before).toBe(2);
    expect(entries.map((e) => e.entityId)).toEqual(
      expect.arrayContaining([docs.members.id, docs.private.id]),
    );
    expect(entries.at(-1)!.metadata).toEqual({ access: 'view', visibility: 'private' });
  });

  it('applies the same rule to global search', async () => {
    const word = `zx${crypto.randomUUID().slice(0, 8)}`;
    const make = (visibility: 'public' | 'members' | 'private') =>
      createTestDocument(db, {
        organizationId: iecep.id,
        typeId: world.types.proposal.id,
        title: `${word} ${visibility} report`,
        status: 'available',
        createdById: userIds.iecepOfficer,
        visibility,
      });
    const pub = await make('public');
    const members = await make('members');
    const priv = await make('private');
    const ids = async (token?: string) =>
      (
        (await call('get', `/documents?q=${word}`, token).expect(200)).body as {
          items: { id: string }[];
        }
      ).items
        .map((d) => d.id)
        .sort();

    expect(await ids()).toEqual([pub.id]);
    expect(await ids(tokenOf.iecepMember)).toEqual([pub.id, members.id].sort());
    expect(await ids(tokenOf.iecepOfficer)).toEqual([pub.id, members.id, priv.id].sort());
    expect(await ids(tokenOf.jpiceOfficer)).toEqual([pub.id]);
  });
});

describe('PATCH /documents/:documentId/visibility', () => {
  const url = (id: string) => `/documents/${id}/visibility`;

  it('lets the organization’s officer change it at any time, audited, and serves it at once', async () => {
    const doc = await iecepDocument('private');
    await call('get', `/documents/${doc.id}`).expect(404);
    const res = await call('patch', url(doc.id), tokenOf.iecepOfficer, {
      visibility: 'public',
    }).expect(200);
    expect(res.body).toMatchObject({ id: doc.id, visibility: 'public', status: 'available' });
    await call('get', `/documents/${doc.id}`).expect(200);

    const entries = await db.auditLog.findMany({
      where: { action: 'visibility_change', entityId: doc.id },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorId: userIds.iecepOfficer,
      organizationId: iecep.id,
      metadata: { from: 'private', to: 'public' },
    });

    const archived = await iecepDocument('archived');
    await call('patch', url(archived.id), tokenOf.iecepOfficer, { visibility: 'private' }).expect(
      200,
    );
  });

  it('refuses an admin without changing the document or writing an override entry', async () => {
    const doc = await iecepDocument('private');
    await call('patch', url(doc.id), tokenOf.admin, { visibility: 'public' }).expect(403);
    expect((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).visibility).toBe(
      'private',
    );
    expect(
      await db.auditLog.count({
        where: {
          action: 'admin_override',
          actorId: userIds.admin,
          metadata: { path: ['route'], equals: '/api/v1/documents/:documentId/visibility' },
        },
      }),
    ).toBe(0);
  });

  it('401s signed out and 403s members, advisers and other organizations', async () => {
    const doc = await iecepDocument('members');
    await call('patch', url(doc.id), undefined, { visibility: 'public' }).expect(401);
    for (const who of ['iecepMember', 'ceaAdviser', 'ceaGovernor', 'jpiceOfficer'] as const) {
      await call('patch', url(doc.id), tokenOf[who], { visibility: 'public' }).expect(403);
    }
    expect((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).visibility).toBe(
      'members',
    );
  });

  it('validates the body with the shared schema', async () => {
    const doc = await iecepDocument('public');
    const t = tokenOf.iecepOfficer;
    await call('patch', url(doc.id), t, { visibility: 'everyone' }).expect(400);
    await call('patch', url(doc.id), t, {}).expect(400);
    await call('patch', url(doc.id), t, { visibility: 'private', title: 'X' }).expect(400);
    // Visibility no longer goes through the details PATCH.
    await call('patch', `/documents/${doc.id}`, t, { visibility: 'private' }).expect(400);
  });

  it('404s an unknown document', async () => {
    await call('patch', url(crypto.randomUUID()), tokenOf.iecepOfficer, {
      visibility: 'public',
    }).expect(404);
  });
});

describe('no review or approval endpoints', () => {
  it.each(['submit', 'approve', 'reject'])(
    'POST /documents/:id/%s does not exist',
    async (path) => {
      const doc = await iecepDocument('private');
      for (const who of ['iecepOfficer', 'ceaGovernor', 'admin'] as const) {
        await call('post', `/documents/${doc.id}/${path}`, tokenOf[who], {}).expect(404);
      }
    },
  );
});

describe('document authorization: cross-organization and term checks', () => {
  it('a JPICE officer can act on JPICE documents but not on the same action for IECEP', async () => {
    const jpiceDoc = await iecepDocument('private', world.orgs.jpice.id);
    const iecepDoc = await iecepDocument('public');
    const t = tokenOf.jpiceOfficer;
    await call('patch', `/documents/${jpiceDoc.id}`, t, { title: 'Own document' }).expect(200);
    await call('patch', `/documents/${iecepDoc.id}`, t, { title: 'Not mine' }).expect(403);
    await call('delete', `/documents/${iecepDoc.id}`, t).expect(403);
    const after = await db.document.findUniqueOrThrow({ where: { id: iecepDoc.id } });
    expect(after.title).not.toBe('Not mine');
    expect(after.deletedAt).toBeNull();
  });

  it('archives a document and restores it to available, auditing both', async () => {
    const doc = await iecepDocument('members', world.orgs.jpice.id);
    const t = tokenOf.jpiceOfficer;
    const archived = await call('post', `/documents/${doc.id}/archive`, t).expect(200);
    expect(archived.body).toMatchObject({ status: 'archived', visibility: 'members' });
    await call('post', `/documents/${doc.id}/archive`, t).expect(409);
    const restored = await call('post', `/documents/${doc.id}/restore`, t).expect(200);
    expect(restored.body).toMatchObject({ status: 'available', visibility: 'members' });
    const actions = await db.auditLog.findMany({
      where: { entityId: doc.id },
      orderBy: { createdAt: 'asc' },
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toEqual(['archive', 'restore']);
  });

  it('cannot move a document to another organization or set its status through the body', async () => {
    await call('post', '/organizations/jpice/documents', tokenOf.jpiceOfficer, {
      ...createBody(),
      organizationId: iecep.id,
    }).expect(400);
    await call('post', '/organizations/jpice/documents', tokenOf.jpiceOfficer, {
      ...createBody(),
      status: 'available',
    }).expect(400);
  });

  it('ignores roles claimed in the token: memberships come from the database', async () => {
    const forged = await signFor(userIds.jpiceOfficer, { isAdmin: true });
    const doc = await iecepDocument('private');
    await call('patch', `/documents/${doc.id}`, forged, { title: 'Claimed admin' }).expect(403);
  });

  it('grants nothing to a membership whose term has ended', async () => {
    const doc = await iecepDocument('private', world.orgs.jpice.id);
    await call('patch', `/documents/${doc.id}`, tokenOf.pastJpiceOfficer, {
      title: 'Old officer',
    }).expect(403);
    await call('get', `/documents/${doc.id}`, tokenOf.pastJpiceOfficer).expect(404);
  });

  it('audits an admin override on a write, but not an officer acting in their own right', async () => {
    const doc = await iecepDocument('public');
    await call('patch', `/documents/${doc.id}`, tokenOf.admin, { title: 'Admin edit' }).expect(200);
    const overrides = await db.auditLog.findMany({
      where: {
        action: 'admin_override',
        actorId: userIds.admin,
        organizationId: iecep.id,
        entityType: 'organization',
      },
    });
    expect(overrides.length).toBeGreaterThan(0);
    expect(overrides.at(-1)!.metadata).toEqual({
      required: 'role:officer',
      method: 'PATCH',
      route: '/api/v1/documents/:documentId',
    });

    await call('patch', `/documents/${doc.id}`, tokenOf.iecepOfficer, { title: 'Own' }).expect(200);
    expect(
      await db.auditLog.count({
        where: { action: 'admin_override', actorId: userIds.iecepOfficer },
      }),
    ).toBe(0);
  });

  it('404s writes on unknown or deleted documents for authorized users too', async () => {
    await call('patch', `/documents/${crypto.randomUUID()}`, tokenOf.admin, { title: 'X' }).expect(
      404,
    );
    const deleted = await iecepDocument('public');
    await call('delete', `/documents/${deleted.id}`, tokenOf.iecepOfficer).expect(204);
    await call('delete', `/documents/${deleted.id}`, tokenOf.iecepOfficer).expect(404);
  });
});

describe('document reads: caching headers', () => {
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

  it('rejects a search query shorter than 2 characters', async () => {
    await call('get', '/documents?q=a').expect(400);
    await call('get', '/documents').expect(400);
  });

  it('caches search publicly only for signed-out readers', async () => {
    const anon = await call('get', '/documents?q=report').expect(200);
    expect(anon.headers['cache-control']).toContain('public');
    const signedIn = await call('get', '/documents?q=report', tokenOf.student).expect(200);
    expect(signedIn.headers['cache-control']).toBe('private, no-store');
  });
});

describe('GET /document-types', () => {
  it('lists the types publicly, cacheable', async () => {
    const res = await call('get', '/document-types').expect(200);
    expect((res.body as { types: { slug: string }[] }).types.map((t) => t.slug)).toEqual(
      expect.arrayContaining(['activity-proposal', 'accomplishment-report']),
    );
    expect(res.headers['cache-control']).toContain('public');
  });
});

describe('uploads', () => {
  const pdf = { filename: 'proposal.pdf', contentType: 'application/pdf', sizeBytes: 1000 };

  it('issues a pre-signed PUT only to the organization officers', async () => {
    const url = '/organizations/iecep/documents/upload-url';
    await call('post', url, undefined, pdf).expect(401);
    await call('post', url, tokenOf.student, pdf).expect(403);
    await call('post', url, tokenOf.jpiceOfficer, pdf).expect(403);
    await call('post', url, tokenOf.iecepMember, pdf).expect(403);
    const res = await call('post', url, tokenOf.iecepOfficer, pdf).expect(201);
    const body = res.body as { uploadKey: string; url: string; method: string };
    expect(body.uploadKey).toMatch(new RegExp(`^uploads/${iecep.id}/[0-9a-f-]{36}$`));
    expect(body).toMatchObject({
      method: 'PUT',
      url: `https://storage.test/${body.uploadKey}?put`,
    });
    expect(res.headers['cache-control']).toBe('private, no-store');
    const intent = await db.uploadIntent.findUniqueOrThrow({ where: { key: body.uploadKey } });
    expect(intent).toMatchObject({
      userId: userIds.iecepOfficer,
      organizationId: iecep.id,
      usedAt: null,
    });
  });

  it('refuses types outside the allow-list, mismatched extensions and files over 25 MB', async () => {
    const t = tokenOf.iecepOfficer;
    const url = '/organizations/iecep/documents/upload-url';
    await call('post', url, t, {
      ...pdf,
      filename: 'x.exe',
      contentType: 'application/x-msdownload',
    }).expect(400);
    await call('post', url, t, { ...pdf, filename: 'proposal.docx' }).expect(400);
    await call('post', url, t, { ...pdf, sizeBytes: 25 * 1024 * 1024 + 1 }).expect(400);
    await call('post', url, t, { ...pdf, sizeBytes: 0 }).expect(400);
    await call('post', url, t, { ...pdf, filename: '../../etc/passwd.pdf' }).expect(400);
  });

  it('creates a scanning document, visible only to its uploader, and queues the scan', async () => {
    const key = await uploadFor(userIds.iecepOfficer, iecep.id);
    const res = await call('post', '/organizations/iecep/documents', tokenOf.iecepOfficer, {
      ...createBody(key),
      visibility: 'public',
      tags: ['Bridge', 'bridge', 'ce week'],
    }).expect(201);
    const body = res.body as {
      id: string;
      status: string;
      visibility: string;
      tags: string[];
      currentVersion: { version: number; scanStatus: string };
    };
    expect(body).toMatchObject({
      status: 'scanning',
      visibility: 'public',
      tags: ['bridge', 'ce week'],
    });
    expect(body.currentVersion).toMatchObject({ version: 1, scanStatus: 'pending' });
    const doc = await db.document.findUniqueOrThrow({ where: { id: body.id } });
    expect(queued).toContain(doc.currentVersionId);
    expect(
      await db.auditLog.count({
        where: { action: 'upload', entityId: body.id, actorId: userIds.iecepOfficer },
      }),
    ).toBe(1);

    // Public once scanned, but not before: only the uploader sees it until then.
    await call('get', `/documents/${body.id}`, tokenOf.iecepOfficer).expect(200);
    for (const who of [undefined, tokenOf.iecepSecretary, tokenOf.iecepMember, tokenOf.admin]) {
      await call('get', `/documents/${body.id}`, who).expect(404);
    }
  });

  it('defaults the visibility of a new upload to public', async () => {
    const key = await uploadFor(userIds.iecepOfficer, iecep.id);
    const res = await call(
      'post',
      '/organizations/iecep/documents',
      tokenOf.iecepOfficer,
      createBody(key),
    ).expect(201);
    expect(res.body).toMatchObject({ visibility: 'public' });
  });

  it('refuses an upload key that is someone else’s, another organization’s, or already used', async () => {
    const theirs = await uploadFor(userIds.admin, iecep.id);
    await call(
      'post',
      '/organizations/iecep/documents',
      tokenOf.iecepOfficer,
      createBody(theirs),
    ).expect(400);
    const jpiceKey = await uploadFor(userIds.jpiceOfficer, world.orgs.jpice.id);
    await call(
      'post',
      '/organizations/iecep/documents',
      tokenOf.iecepOfficer,
      createBody(jpiceKey),
    ).expect(400);
    const mine = await uploadFor(userIds.iecepOfficer, iecep.id);
    await call(
      'post',
      '/organizations/iecep/documents',
      tokenOf.iecepOfficer,
      createBody(mine),
    ).expect(201);
    await call(
      'post',
      '/organizations/iecep/documents',
      tokenOf.iecepOfficer,
      createBody(mine),
    ).expect(400);
  });

  it('adds a version only for the organization officers, without making it current', async () => {
    const doc = await iecepDocument('public');
    const url = `/documents/${doc.id}/versions`;
    const key = async (userId: string) => ({ uploadKey: await uploadFor(userId, iecep.id) });
    await call('post', url, undefined, await key(userIds.iecepOfficer)).expect(401);
    await call('post', url, tokenOf.jpiceOfficer, await key(userIds.jpiceOfficer)).expect(403);
    await call('post', url, tokenOf.iecepMember, await key(userIds.iecepMember)).expect(403);
    const res = await call(
      'post',
      url,
      tokenOf.iecepOfficer,
      await key(userIds.iecepOfficer),
    ).expect(201);
    expect(res.body).toMatchObject({ version: 2, scanStatus: 'pending', isCurrent: false });
    const after = await db.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(after.currentVersionId).toBe(doc.currentVersionId);
    expect(after.status).toBe('available');
  });

  it('lists versions: a file being scanned is listed only for its uploader', async () => {
    const doc = await iecepDocument('public');
    await call('post', `/documents/${doc.id}/versions`, tokenOf.iecepOfficer, {
      uploadKey: await uploadFor(userIds.iecepOfficer, iecep.id),
    }).expect(201);
    const versions = async (token?: string) =>
      (
        (await call('get', `/documents/${doc.id}/versions`, token).expect(200)).body as {
          versions: { version: number }[];
        }
      ).versions.map((v) => v.version);
    expect(await versions(tokenOf.iecepOfficer)).toEqual([2, 1]);
    expect(await versions(tokenOf.iecepSecretary)).toEqual([1]);
    expect(await versions(tokenOf.admin)).toEqual([1]);
    expect(await versions()).toEqual([1]);
  });

  it('signs downloads for clean, visible versions only; never cacheable', async () => {
    const pub = await iecepDocument('public');
    const v1 = (await db.document.findUniqueOrThrow({ where: { id: pub.id } })).currentVersionId!;
    const res = await call('get', `/documents/${pub.id}/versions/${v1}/download-url`).expect(200);
    expect((res.body as { url: string }).url).toContain('disposition=attachment');
    expect(res.headers['cache-control']).toBe('private, no-store');
    const inline = await call(
      'get',
      `/documents/${pub.id}/versions/${v1}/download-url?disposition=inline`,
    ).expect(200);
    expect((inline.body as { url: string }).url).toContain('disposition=inline');

    const priv = await iecepDocument('private');
    const pv = (await db.document.findUniqueOrThrow({ where: { id: priv.id } })).currentVersionId!;
    const download = (token?: string) =>
      call('get', `/documents/${priv.id}/versions/${pv}/download-url`, token);
    await download().expect(404);
    await download(tokenOf.jpiceOfficer).expect(404);
    await download(tokenOf.iecepMember).expect(404);
    await download(tokenOf.iecepOfficer).expect(200);
    await download(tokenOf.admin).expect(200);
    expect(
      await db.auditLog.count({
        where: { action: 'admin_override', actorId: userIds.admin, entityId: priv.id },
      }),
    ).toBe(1);

    // A version from another document is not reachable through this one.
    await call('get', `/documents/${pub.id}/versions/${pv}/download-url`, tokenOf.admin).expect(
      404,
    );

    // A refused file is never served: its uploader learns why, everyone else does not see it.
    await db.documentVersion.update({ where: { id: v1 }, data: { scanStatus: 'infected' } });
    const refused = (token: string) =>
      call('get', `/documents/${pub.id}/versions/${v1}/download-url`, token);
    await refused(tokenOf.iecepOfficer).expect(409);
    await refused(tokenOf.admin).expect(404);
  });
});
