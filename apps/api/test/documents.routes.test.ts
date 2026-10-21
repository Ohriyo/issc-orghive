import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { memoryCache } from '#src/lib/cache';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createDashboardRepository } from '#src/repositories/dashboard.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createDocumentTypeRepository } from '#src/repositories/document-type.repository';
import { createAccountRepository } from '#src/repositories/account.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { createProjectRepository } from '#src/repositories/project.repository';
import { createAccessService } from '#src/services/access.service';
import { createDocumentPreviewService } from '#src/services/document-preview.service';
import { createDocumentService } from '#src/services/document.service';
import { createPageTokenService, PAGE_TOKEN_TTL_SECONDS } from '#src/services/page-token.service';
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
  // Only page images are ever read through the API; every read is recorded.
  read: (key) => {
    reads.push(key);
    return key.startsWith('pages/')
      ? Promise.resolve(Buffer.from(`webp:${key}`))
      : Promise.reject(new Error(`The API never reads ${key}`));
  },
  put: () => Promise.resolve(),
  copy: () => Promise.resolve(),
  move: () => Promise.resolve(),
  delete: () => Promise.resolve(),
  list: () => Promise.resolve([]),
};
const reads: string[] = [];
/** The page tokens' clock, moved forward to expire them. */
let clock = new Date();
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
    documentPreviews: createDocumentPreviewService({
      documents,
      viewers,
      pageTokens: createPageTokenService({ ...testKeys(), now: () => clock }),
      storage,
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
  actingAs: 'Ana Reyes',
});

/** Who acts for the shared account on archives and deletions. */
const ACTING = { actingAs: 'Ana Reyes' };

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
    run: (t, id) => call('post', `/documents/${id}/archive`, t, ACTING),
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
    run: (t, id) => call('delete', `/documents/${id}`, t, ACTING),
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
    await call('delete', `/documents/${iecepDoc.id}`, t, ACTING).expect(403);
    const after = await db.document.findUniqueOrThrow({ where: { id: iecepDoc.id } });
    expect(after.title).not.toBe('Not mine');
    expect(after.deletedAt).toBeNull();
  });

  it('archives a document and restores it to available, auditing both', async () => {
    const doc = await iecepDocument('governing', world.orgs.jpice.id);
    const t = tokenOf.jpiceOfficer;
    const archived = await call('post', `/documents/${doc.id}/archive`, t, ACTING).expect(200);
    expect(archived.body).toMatchObject({ status: 'archived', visibility: 'governing' });
    await call('post', `/documents/${doc.id}/archive`, t, ACTING).expect(409);
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
    await call('delete', `/documents/${deleted.id}`, tokenOf.iecepOfficer, ACTING).expect(204);
    await call('delete', `/documents/${deleted.id}`, tokenOf.iecepOfficer, ACTING).expect(404);
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
    const key = async (userId: string) => ({
      uploadKey: await uploadFor(userId, iecep.id),
      ...ACTING,
    });
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
      ...ACTING,
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

  it('signs downloads for the owning organization only; never cacheable', async () => {
    const pub = await iecepDocument('public');
    const v1 = (await db.document.findUniqueOrThrow({ where: { id: pub.id } })).currentVersionId!;
    const own = (path: string) => call('get', path, tokenOf.iecepOfficer).expect(200);
    const res = await own(`/documents/${pub.id}/versions/${v1}/download-url`);
    expect((res.body as { url: string }).url).toContain('disposition=attachment');
    expect(res.headers['cache-control']).toBe('private, no-store');
    const inline = await own(`/documents/${pub.id}/versions/${v1}/download-url?disposition=inline`);
    expect((inline.body as { url: string }).url).toContain('disposition=inline');

    const priv = await iecepDocument('private');
    const pv = (await db.document.findUniqueOrThrow({ where: { id: priv.id } })).currentVersionId!;
    await own(`/documents/${priv.id}/versions/${pv}/download-url`);

    // A version from another document is not reachable through this one.
    await call(
      'get',
      `/documents/${pub.id}/versions/${pv}/download-url`,
      tokenOf.iecepOfficer,
    ).expect(404);

    // A refused file is never served, not even to its owner, who learns why.
    await db.documentVersion.update({ where: { id: v1 }, data: { scanStatus: 'infected' } });
    await call(
      'get',
      `/documents/${pub.id}/versions/${v1}/download-url`,
      tokenOf.iecepOfficer,
    ).expect(409);
  });

  it('refuses the original to everyone but the owner, whatever the visibility', async () => {
    for (const target of ['public', 'governing', 'private'] as const) {
      const doc = await iecepDocument(target);
      const v = (await db.document.findUniqueOrThrow({ where: { id: doc.id } })).currentVersionId!;
      const download = (token?: string) =>
        call('get', `/documents/${doc.id}/versions/${v}/download-url`, token);
      await download().expect(401);
      // Signed in elsewhere: the governing bodies (CSC-CEA, the ISSC) included.
      for (const person of ['student', 'jpiceOfficer', 'ceaGovernor', 'cscCat', 'admin'] as const) {
        const res = await download(tokenOf[person]);
        expect(res.status, `${person} on a ${target} document`).toBe(403);
        expect(JSON.stringify(res.body)).not.toContain('storage.test');
      }
      await download(tokenOf.iecepOfficer).expect(200);
    }
  });
});

describe('view-only viewer (CLAUDE.md: originals go to the owning organization only)', () => {
  const PAGES = [
    [1240, 1754],
    [1240, 1754],
    [1754, 1240],
  ];

  /** An IECEP document whose current version has its watermarked pages rendered. */
  async function rendered(target: Target) {
    const doc = await iecepDocument(target);
    const versionId = (await db.document.findUniqueOrThrow({ where: { id: doc.id } }))
      .currentVersionId!;
    await db.documentVersion.update({
      where: { id: versionId },
      data: {
        previewStatus: 'ready',
        previewPages: PAGES,
        pageCount: 3,
        thumbnailKey: `thumbnails/${doc.id}/${versionId}.webp`,
      },
    });
    return { id: doc.id, versionId };
  }

  interface ViewerBody {
    versionId: string;
    status: string;
    pages: { width: number; height: number }[];
    totalPages: number;
    token: string | null;
    expiresAt: string | null;
  }

  const viewer = async (id: string, token?: string) => {
    const res = await call('get', `/documents/${id}/viewer`, token).expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    return res.body as ViewerBody;
  };
  const page = (id: string, n: number, pageToken?: string) =>
    request(app).get(
      `/api/v1/documents/${id}/pages/${n}` +
        (pageToken === undefined ? '' : `?token=${encodeURIComponent(pageToken)}`),
    );

  it('gives a visitor the watermarked pages, and never the original by any route', async () => {
    clock = new Date();
    reads.length = 0;
    const { id, versionId } = await rendered('public');
    const body = await viewer(id);
    expect(body).toMatchObject({ versionId, status: 'ready', totalPages: 3 });
    expect(body.pages).toEqual(PAGES.map(([width, height]) => ({ width, height })));
    expect(body.token).toEqual(expect.any(String));

    const res = await page(id, 2, body.token!).expect(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(res.headers['content-disposition']).toBe('inline');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(Buffer.from(res.body as Buffer).toString()).toBe(`webp:pages/${id}/${versionId}/2.webp`);

    // Every other read route: no original bytes, no link to them.
    const { storageKey } = await db.documentVersion.findUniqueOrThrow({ where: { id: versionId } });
    for (const path of [
      `/documents/${id}`,
      `/documents/${id}/versions`,
      `/documents/${id}/viewer`,
    ]) {
      const text = JSON.stringify((await call('get', path).expect(200)).body);
      expect(text, path).not.toContain(storageKey);
    }
    const download = `/documents/${id}/versions/${versionId}/download-url`;
    await call('get', download).expect(401);
    await call('get', download, tokenOf.student).expect(403);
    // The API only ever read page images: never the uploaded file.
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((key) => key.startsWith('pages/'))).toBe(true);
  });

  it('lets each viewer see what the visibility allows, and nothing more', async () => {
    clock = new Date();
    const governing = await rendered('governing');
    expect((await viewer(governing.id, tokenOf.ceaGovernor)).status).toBe('ready');
    expect((await viewer(governing.id, tokenOf.admin)).status).toBe('ready');
    await call('get', `/documents/${governing.id}/viewer`).expect(404);
    await call('get', `/documents/${governing.id}/viewer`, tokenOf.jpiceOfficer).expect(404);

    const priv = await rendered('private');
    expect((await viewer(priv.id, tokenOf.iecepOfficer)).status).toBe('ready');
    for (const person of ['ceaGovernor', 'admin', 'jpiceOfficer', 'student'] as const) {
      await call('get', `/documents/${priv.id}/viewer`, tokenOf[person]).expect(404);
    }
  });

  it('expires page tokens after 5 minutes', async () => {
    clock = new Date();
    const { id } = await rendered('public');
    const { token, expiresAt } = await viewer(id);
    expect(new Date(expiresAt!).getTime() - clock.getTime()).toBe(PAGE_TOKEN_TTL_SECONDS * 1000);
    await page(id, 1, token!).expect(200);

    clock = new Date(clock.getTime() + PAGE_TOKEN_TTL_SECONDS * 1000 + 1000);
    const expired = await page(id, 1, token!).expect(403);
    expect((expired.body as { error: { message: string } }).error.message).toMatch(/expired/);
    // A fresh token from the viewer works again.
    await page(id, 1, (await viewer(id)).token!).expect(200);
  });

  it('refuses a token for another document, a forged one, an access token, or none', async () => {
    clock = new Date();
    const a = await rendered('public');
    const b = await rendered('public');
    const tokenA = (await viewer(a.id)).token!;
    await page(b.id, 1, tokenA).expect(403);
    await page(a.id, 1, `${tokenA.slice(0, -4)}AAAA`).expect(403);
    await page(a.id, 1, tokenOf.iecepOfficer).expect(403);
    await page(a.id, 1).expect(400);
  });

  it('serves no page past the last one, nor of a document deleted since', async () => {
    clock = new Date();
    const { id } = await rendered('public');
    const { token } = await viewer(id);
    await page(id, 4, token!).expect(404);
    await page(id, 0, token!).expect(400);
    await db.document.update({ where: { id }, data: { deletedAt: new Date() } });
    await page(id, 1, token!).expect(404);
  });

  it('says "preparing" with no token until the pages are ready', async () => {
    const doc = await iecepDocument('public');
    expect(await viewer(doc.id)).toMatchObject({
      status: 'pending',
      pages: [],
      totalPages: 0,
      token: null,
      expiresAt: null,
    });
    const scanning = await iecepDocument('scanning');
    expect((await viewer(scanning.id, tokenOf.iecepOfficer)).status).toBe('pending');
  });
});

describe('"Acting as" on a shared account (docs/DOMAIN_RULES.md, "Accounts")', () => {
  it('400s an upload, a new version, an archive or a deletion without a name, and changes nothing', async () => {
    const t = tokenOf.iecepOfficer;
    const key = await uploadFor(userIds.iecepOfficer, iecep.id);
    const { actingAs: _, ...unnamed } = createBody(key);
    await call('post', '/organizations/iecep/documents', t, unnamed).expect(400);
    await call('post', '/organizations/iecep/documents', t, {
      ...unnamed,
      actingAs: '   ',
    }).expect(400);
    await call('post', '/organizations/iecep/documents', t, {
      ...unnamed,
      actingAs: 'x'.repeat(81),
    }).expect(400);

    const doc = await iecepDocument('public');
    await call('post', `/documents/${doc.id}/versions`, t, { uploadKey: key }).expect(400);
    await call('post', `/documents/${doc.id}/archive`, t).expect(400);
    await call('post', `/documents/${doc.id}/archive`, t, { actingAs: 'J' }).expect(400);
    await call('delete', `/documents/${doc.id}`, t).expect(400);
    const after = await db.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(after).toMatchObject({ status: 'available', deletedAt: null });
    expect(await db.documentVersion.count({ where: { documentId: doc.id } })).toBe(1);
    // The unused upload key still works once a name is given.
    await call('post', '/organizations/iecep/documents', t, createBody(key)).expect(201);
  });

  it('stores the trimmed name on the version and in the audit log of every upload, archive and deletion', async () => {
    const t = tokenOf.iecepOfficer;
    const created = await call('post', '/organizations/iecep/documents', t, {
      ...createBody(await uploadFor(userIds.iecepOfficer, iecep.id)),
      actingAs: '  Juan Dela Cruz ',
    }).expect(201);
    const id = (created.body as { id: string }).id;
    await call('post', `/documents/${id}/versions`, t, {
      uploadKey: await uploadFor(userIds.iecepOfficer, iecep.id),
      actingAs: 'Maria Santos',
    }).expect(201);
    const versions = await db.documentVersion.findMany({
      where: { documentId: id },
      orderBy: { version: 'asc' },
      select: { actingAs: true },
    });
    expect(versions.map((v) => v.actingAs)).toEqual(['Juan Dela Cruz', 'Maria Santos']);

    const doc = await iecepDocument('public');
    await call('post', `/documents/${doc.id}/archive`, t, { actingAs: 'Pedro Reyes' }).expect(200);
    const gone = await iecepDocument('public');
    await call('delete', `/documents/${gone.id}`, t, { actingAs: 'Rosa Lim' }).expect(204);

    const audits = await db.auditLog.findMany({
      where: { entityId: { in: [id, doc.id, gone.id] } },
      orderBy: { createdAt: 'asc' },
      select: { action: true, actingAs: true },
    });
    expect(audits).toEqual([
      { action: 'upload', actingAs: 'Juan Dela Cruz' },
      { action: 'upload', actingAs: 'Maria Santos' },
      { action: 'archive', actingAs: 'Pedro Reyes' },
      { action: 'delete', actingAs: 'Rosa Lim' },
    ]);
  });

  it('shows the name in the version history and activity to the organization’s own account only', async () => {
    const doc = await iecepDocument('governing');
    await call('post', `/documents/${doc.id}/versions`, tokenOf.iecepOfficer, {
      uploadKey: await uploadFor(userIds.iecepOfficer, iecep.id),
      actingAs: 'Juan Dela Cruz',
    }).expect(201);
    const actingAsSeenBy = async (token?: string) =>
      (
        (await call('get', `/documents/${doc.id}/versions`, token).expect(200)).body as {
          versions: { version: number; actingAs: string | null }[];
        }
      ).versions.map((v) => [v.version, v.actingAs]);
    expect(await actingAsSeenBy(tokenOf.iecepOfficer)).toEqual([
      [2, 'Juan Dela Cruz'],
      [1, null],
    ]);
    // Its governing bodies read the file but never learn who uploaded it; nor does a visitor.
    expect(await actingAsSeenBy(tokenOf.ceaGovernor)).toEqual([[1, null]]);
    expect(await actingAsSeenBy(tokenOf.admin)).toEqual([[1, null]]);
    const pub = await iecepDocument('public');
    await call('post', `/documents/${pub.id}/archive`, tokenOf.iecepOfficer, {
      actingAs: 'Pedro Reyes',
    }).expect(200);
    await call('post', `/documents/${pub.id}/restore`, tokenOf.iecepOfficer).expect(200);
    const publicView = await call('get', `/documents/${pub.id}/versions`).expect(200);
    expect(JSON.stringify(publicView.body)).not.toContain('Pedro');
    const publicList = await call('get', '/organizations/iecep/documents').expect(200);
    expect(JSON.stringify(publicList.body)).not.toMatch(/Juan Dela Cruz|Pedro Reyes/);

    // The organization's own dashboard activity carries it (GET /me/dashboard maps it as is).
    const activity = await createDashboardRepository(db).listActivity(
      {
        kind: 'account',
        userId: userIds.iecepOfficer,
        organizationId: iecep.id,
        organizationType: 'SBO',
      },
      iecep.id,
    );
    expect(activity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'archive', actingAs: 'Pedro Reyes' }),
        expect.objectContaining({ action: 'upload', actingAs: 'Juan Dela Cruz' }),
      ]),
    );
  });
});
