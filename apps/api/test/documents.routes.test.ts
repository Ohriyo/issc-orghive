import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { memoryCache } from '#src/lib/cache';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createDocumentTypeRepository } from '#src/repositories/document-type.repository';
import { createAccountRepository } from '#src/repositories/account.repository';
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
import { buildWorld, createAccount, createTestDocument, resetDb, testDb, type World } from './db';
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
  copy: () => Promise.resolve(),
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

/**
 * Who asks, by shared account (docs/DOMAIN_RULES.md, "Accounts"): IECEP's own account; its
 * governing bodies (the CSC-CEA and the ISSC, whose account is the admin); a sibling SBO
 * (JPICE); another college's CSC; a signed-in account acting for no organization (student).
 */
type Role =
  'anonymous' | 'student' | 'jpiceOfficer' | 'iecepOfficer' | 'ceaGovernor' | 'cscCat' | 'admin';
const ROLES: Role[] = [
  'anonymous',
  'student',
  'jpiceOfficer',
  'iecepOfficer',
  'ceaGovernor',
  'cscCat',
  'admin',
];
type Person = Exclude<Role, 'anonymous'> | 'pastJpiceOfficer';

let world: World;
let iecep: { id: string; slug: string };
let app: ReturnType<typeof buildTestApp>;
const userIds = {} as Record<Person, string>;
const tokenOf = {} as Record<Person, string>;

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

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

  const iecepAccount = await createAccount(db, 'iecep@test.local', iecep.id);
  // A former JPICE account, deactivated when it was replaced: it acts for nobody.
  const pastJpice = await db.user.create({
    data: {
      email: 'past.jpice@test.local',
      name: 'past',
      passwordHash: 'x',
      organizationId: world.orgs.jpice.id,
      disabledAt: daysFromNow(-35),
    },
  });
  const people: Record<Person, string> = {
    student: world.users.outsider.id,
    jpiceOfficer: world.users.officer.id,
    iecepOfficer: iecepAccount.id,
    ceaGovernor: world.users.governor.id,
    cscCat: world.users.cscCat.id,
    admin: world.users.issc.id,
    pastJpiceOfficer: pastJpice.id,
  };
  for (const [key, userId] of Object.entries(people) as [Person, string][]) {
    userIds[key] = userId;
    tokenOf[key] = await signFor(userId);
  }

  const accounts = createAccountRepository(db);
  const organizations = createOrganizationRepository(db);
  const documents = createDocumentRepository(db);
  const audit = createAuditLogRepository(db);
  const viewers = createDocumentViewerService({ accounts });
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
      accounts,
      organizations,
      documents,
      projects: createProjectRepository(db),
    }),
  });
});

type Target = 'public' | 'governing' | 'private' | 'scanning' | 'archived';

/** A fresh IECEP document uploaded by its officer, so cases never depend on each other. */
async function iecepDocument(target: Target, orgId = iecep.id) {
  const status =
    target === 'scanning' ? 'scanning' : target === 'archived' ? 'archived' : 'available';
  const visibility = target === 'governing' || target === 'private' ? target : 'public';
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
  ceaGovernor: 404,
  cscCat: 404,
  admin: 404,
  ...seen,
});

/** Writes: 401 signed out, 403 for every account but IECEP's own (the ISSC included). */
const OWN_WRITE = (ok: number): Record<Role, number> => ({
  anonymous: 401,
  student: 403,
  jpiceOfficer: 403,
  iecepOfficer: ok,
  ceaGovernor: 403,
  cscCat: 403,
  admin: 403,
});

/**
 * Every document action on IECEP's Paperworks. Reads of a document the account may not see
 * are 404 (its existence is not revealed); writes are 401 signed out and 403 for any other
 * account. Governing bodies (CSC-CEA, ISSC) read `governing` files only; nobody else's
 * account reads a private, scanning or archived one.
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
    name: 'read a governing-bodies document',
    target: 'governing',
    run: (t, id) => call('get', `/documents/${id}`, t),
    expected: NOT_FOUND_EXCEPT({ iecepOfficer: 200, ceaGovernor: 200, admin: 200 }),
  },
  {
    name: 'read a private document (the organization only, no exceptions)',
    target: 'private',
    run: (t, id) => call('get', `/documents/${id}`, t),
    expected: NOT_FOUND_EXCEPT({ iecepOfficer: 200 }),
  },
  {
    name: 'read a document still being scanned (the organization only)',
    target: 'scanning',
    run: (t, id) => call('get', `/documents/${id}`, t),
    expected: NOT_FOUND_EXCEPT({ iecepOfficer: 200 }),
  },
  {
    name: 'read an archived document',
    target: 'archived',
    run: (t, id) => call('get', `/documents/${id}`, t),
    expected: NOT_FOUND_EXCEPT({ iecepOfficer: 200 }),
  },
  {
    name: 'create a document',
    run: async (t, _id, role) =>
      call('post', '/organizations/iecep/documents', t, await createBodyFor(role)),
    expected: OWN_WRITE(201),
  },
  {
    name: 'edit details',
    target: 'private',
    run: (t, id) => call('patch', `/documents/${id}`, t, { title: 'Edited title' }),
    expected: OWN_WRITE(200),
  },
  {
    name: 'change visibility (the organization only)',
    target: 'private',
    run: (t, id) => call('patch', `/documents/${id}/visibility`, t, { visibility: 'public' }),
    expected: OWN_WRITE(200),
  },
  {
    name: 'archive an available document',
    target: 'public',
    run: (t, id) => call('post', `/documents/${id}/archive`, t),
    expected: OWN_WRITE(200),
  },
  {
    name: 'restore an archived document',
    target: 'archived',
    run: (t, id) => call('post', `/documents/${id}/restore`, t),
    expected: OWN_WRITE(200),
  },
  {
    name: 'delete a document',
    target: 'public',
    run: (t, id) => call('delete', `/documents/${id}`, t),
    expected: OWN_WRITE(204),
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
  let docs: Record<'public' | 'governing' | 'private', { id: string }>;

  beforeAll(async () => {
    docs = {
      public: await iecepDocument('public'),
      governing: await iecepDocument('governing'),
      private: await iecepDocument('private'),
    };
  });

  /** Which of the three test documents this reader gets, from the list and detail. */
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

  it('shows the organization’s own account all three', async () => {
    expect(await seenBy(tokenOf.iecepOfficer)).toEqual(['public', 'governing', 'private']);
  });

  it('shows its governing bodies (its CSC, the ISSC) the governing file, never the private one', async () => {
    expect(await seenBy(tokenOf.ceaGovernor)).toEqual(['public', 'governing']);
    expect(await seenBy(tokenOf.admin)).toEqual(['public', 'governing']);
  });

  it('shows a sibling SBO, another college’s CSC and an account without an organization only public files', async () => {
    for (const who of ['jpiceOfficer', 'cscCat', 'student'] as const) {
      expect(await seenBy(tokenOf[who]), who).toEqual(['public']);
    }
  });

  it('writes no admin override: nobody sees a file past its visibility', async () => {
    expect(
      await db.auditLog.count({ where: { action: 'admin_override', entityType: 'document' } }),
    ).toBe(0);
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

  it('refuses the ISSC account without changing the document or writing an override entry', async () => {
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

  it('401s signed out and 403s every other account, governing bodies included', async () => {
    const doc = await iecepDocument('governing');
    await call('patch', url(doc.id), undefined, { visibility: 'public' }).expect(401);
    for (const who of ['ceaGovernor', 'cscCat', 'admin', 'jpiceOfficer'] as const) {
      await call('patch', url(doc.id), tokenOf[who], { visibility: 'public' }).expect(403);
    }
    expect((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).visibility).toBe(
      'governing',
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
    const doc = await iecepDocument('governing', world.orgs.jpice.id);
    const t = tokenOf.jpiceOfficer;
    const archived = await call('post', `/documents/${doc.id}/archive`, t).expect(200);
    expect(archived.body).toMatchObject({ status: 'archived', visibility: 'governing' });
    await call('post', `/documents/${doc.id}/archive`, t).expect(409);
    const restored = await call('post', `/documents/${doc.id}/restore`, t).expect(200);
    expect(restored.body).toMatchObject({ status: 'available', visibility: 'governing' });
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

  it('reads the account from the database, never from the token', async () => {
    const token = await signFor(userIds.jpiceOfficer);
    const doc = await iecepDocument('private');
    await call('patch', `/documents/${doc.id}`, token, { title: 'Claimed admin' }).expect(403);
  });

  it('grants nothing to a deactivated former account', async () => {
    const doc = await iecepDocument('private', world.orgs.jpice.id);
    await call('patch', `/documents/${doc.id}`, tokenOf.pastJpiceOfficer, {
      title: 'Old officer',
    }).expect(403);
    await call('get', `/documents/${doc.id}`, tokenOf.pastJpiceOfficer).expect(404);
  });

  it('lets the ISSC account write nothing of another organization’s, and audits no override', async () => {
    const doc = await iecepDocument('public');
    await call('patch', `/documents/${doc.id}`, tokenOf.admin, { title: 'Admin edit' }).expect(403);
    expect(
      await db.auditLog.count({ where: { action: 'admin_override', actorId: userIds.admin } }),
    ).toBe(0);
    await call('patch', `/documents/${doc.id}`, tokenOf.iecepOfficer, { title: 'Own' }).expect(200);
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

  it('issues a pre-signed PUT only to the organization’s own account', async () => {
    const url = '/organizations/iecep/documents/upload-url';
    await call('post', url, undefined, pdf).expect(401);
    await call('post', url, tokenOf.student, pdf).expect(403);
    await call('post', url, tokenOf.jpiceOfficer, pdf).expect(403);
    await call('post', url, tokenOf.ceaGovernor, pdf).expect(403);
    await call('post', url, tokenOf.admin, pdf).expect(403);
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

  it('refuses uploads while an admin has deactivated the organization', async () => {
    const url = '/organizations/iecep/documents/upload-url';
    await db.organization.update({ where: { id: iecep.id }, data: { deactivatedAt: new Date() } });
    try {
      const res = await call('post', url, tokenOf.iecepOfficer, pdf).expect(403);
      expect((res.body as { error: { code: string } }).error.code).toBe('ORGANIZATION_INACTIVE');
      // Nobody else can act for it either.
      await call('post', url, tokenOf.admin, pdf).expect(403);
    } finally {
      await db.organization.update({ where: { id: iecep.id }, data: { deactivatedAt: null } });
    }
    await call('post', url, tokenOf.iecepOfficer, pdf).expect(201);
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

  it('creates a scanning document, visible only to its organization, and queues the scan', async () => {
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

    // Public once scanned, but not before: only the organization sees it until then.
    await call('get', `/documents/${body.id}`, tokenOf.iecepOfficer).expect(200);
    for (const who of [undefined, tokenOf.ceaGovernor, tokenOf.admin]) {
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

  it('adds a version only for the organization’s own account, without making it current', async () => {
    const doc = await iecepDocument('public');
    const url = `/documents/${doc.id}/versions`;
    const key = async (userId: string) => ({ uploadKey: await uploadFor(userId, iecep.id) });
    await call('post', url, undefined, await key(userIds.iecepOfficer)).expect(401);
    await call('post', url, tokenOf.jpiceOfficer, await key(userIds.jpiceOfficer)).expect(403);
    await call('post', url, tokenOf.ceaGovernor, await key(userIds.ceaGovernor)).expect(403);
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

  it('lists versions: a file being scanned is listed only for its organization', async () => {
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
    expect(await versions(tokenOf.ceaGovernor)).toEqual([1]);
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
    await download(tokenOf.ceaGovernor).expect(404);
    // Private means private: not the ISSC either.
    await download(tokenOf.admin).expect(404);
    await download(tokenOf.iecepOfficer).expect(200);

    // A version from another document is not reachable through this one.
    await call(
      'get',
      `/documents/${pub.id}/versions/${pv}/download-url`,
      tokenOf.iecepOfficer,
    ).expect(404);

    // A refused file is never served: its uploader learns why, everyone else does not see it.
    await db.documentVersion.update({ where: { id: v1 }, data: { scanStatus: 'infected' } });
    const refused = (token: string) =>
      call('get', `/documents/${pub.id}/versions/${v1}/download-url`, token);
    await refused(tokenOf.iecepOfficer).expect(409);
    await refused(tokenOf.admin).expect(404);
  });
});
