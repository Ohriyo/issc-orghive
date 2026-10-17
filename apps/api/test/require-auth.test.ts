import express from 'express';
import request from 'supertest';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { createErrorHandler } from '#src/middleware/error-handler';
import {
  authOf,
  createOrgGuards,
  maybeAuthOf,
  optionalAuth,
  orgOf,
  requireAuth,
} from '#src/middleware/require-auth';
import type { AccessService } from '#src/services/access.service';
import { createTokenService } from '#src/services/token.service';
import { testKeys } from './auth-fixtures';

const USER = '0195f3c0-0000-7000-8000-000000000001';
const DOC = '0195f3c0-0000-7000-8000-0000000000d1';
const PROJECT = '0195f3c0-0000-7000-8000-0000000000c1';
const JPICE = { id: '0195f3c0-0000-7000-8000-0000000000aa', slug: 'jpice' };
const tokens = createTokenService(testKeys());

/** An access service that knows one organization and one document, and allows `allow`. */
function fakeAccess(allow: boolean) {
  const decide = () =>
    allow ? Promise.resolve('membership' as const) : Promise.reject(AppError.forbidden());
  return {
    resolveBySlug: vi.fn((slug: string) => Promise.resolve(slug === 'jpice' ? JPICE : null)),
    resolveByDocument: vi.fn((id: string) => Promise.resolve(id === DOC ? JPICE : null)),
    resolveByProject: vi.fn((id: string) => Promise.resolve(id === PROJECT ? JPICE : null)),
    requireRole: vi.fn(decide),
  } satisfies AccessService;
}

/** Mutating routes guarded the way CLAUDE.md requires. */
function guardedApp(access: AccessService) {
  const app = express();
  const { requireOrgRole, requireOwnOrgRole } = createOrgGuards(access);
  const ok: express.RequestHandler = (_req, res) => {
    res.json({ userId: authOf(res).userId, org: orgOf(res).slug });
  };
  app.post('/orgs/:slug/documents', requireAuth(tokens), requireOrgRole('officer'), ok);
  app.patch(
    '/documents/:documentId',
    requireAuth(tokens),
    requireOrgRole('officer', 'adviser'),
    ok,
  );
  app.patch('/projects/:projectId', requireAuth(tokens), requireOrgRole('officer'), ok);
  app.patch(
    '/documents/:documentId/visibility',
    requireAuth(tokens),
    requireOwnOrgRole('officer'),
    ok,
  );
  app.get('/maybe', optionalAuth(tokens), (_req, res) => {
    res.json({ userId: maybeAuthOf(res)?.userId ?? null });
  });
  app.use(createErrorHandler(pino({ level: 'silent' })));
  return app;
}

async function tokenFor(opts: { passwordChangeRequired?: boolean } = {}) {
  const { token } = await tokens.sign({
    userId: USER,
    roles: [],
    isAdmin: false,
    passwordChangeRequired: opts.passwordChangeRequired ?? false,
  });
  return token;
}

describe('requireAuth', () => {
  const app = guardedApp(fakeAccess(true));

  it('401: no token, a malformed header, or an invalid token', async () => {
    await request(app).post('/orgs/jpice/documents').expect(401);
    await request(app).post('/orgs/jpice/documents').set('Authorization', 'Basic abc').expect(401);
    await request(app)
      .post('/orgs/jpice/documents')
      .set('Authorization', 'Bearer abc.def.ghi')
      .expect(401);
  });

  it('403: a temporary-password token on any normal route', async () => {
    const res = await request(app)
      .post('/orgs/jpice/documents')
      .set('Authorization', `Bearer ${await tokenFor({ passwordChangeRequired: true })}`)
      .expect(403);
    expect(res.body.error.code).toBe(ErrorCode.PASSWORD_CHANGE_REQUIRED);
  });
});

describe('optionalAuth', () => {
  const app = guardedApp(fakeAccess(true));

  it('treats a request without a header as signed out', async () => {
    expect((await request(app).get('/maybe').expect(200)).body).toEqual({ userId: null });
  });

  it('rejects a header that is present but invalid instead of downgrading to public', async () => {
    await request(app).get('/maybe').set('Authorization', 'Bearer abc.def.ghi').expect(401);
  });

  it('attaches the claims of a valid token', async () => {
    const res = await request(app)
      .get('/maybe')
      .set('Authorization', `Bearer ${await tokenFor()}`)
      .expect(200);
    expect(res.body).toEqual({ userId: USER });
  });
});

describe('org guards', () => {
  const auth = async () => `Bearer ${await tokenFor()}`;

  it('resolves the organization from :slug and checks the roles against it', async () => {
    const access = fakeAccess(true);
    const res = await request(guardedApp(access))
      .post('/orgs/jpice/documents')
      .set('Authorization', await auth())
      .expect(200);
    expect(res.body).toEqual({ userId: USER, org: 'jpice' });
    expect(access.requireRole).toHaveBeenCalledWith(
      USER,
      JPICE,
      ['officer'],
      expect.objectContaining({ method: 'POST', route: '/orgs/:slug/documents' }),
      { adminOverride: true },
    );
  });

  it("resolves the organization from the document's organization", async () => {
    const access = fakeAccess(true);
    await request(guardedApp(access))
      .patch(`/documents/${DOC}`)
      .set('Authorization', await auth())
      .expect(200);
    expect(access.resolveByDocument).toHaveBeenCalledWith(DOC);
    expect(access.requireRole).toHaveBeenCalledWith(
      USER,
      JPICE,
      ['officer', 'adviser'],
      expect.objectContaining({ route: '/documents/:documentId' }),
      { adminOverride: true },
    );
  });

  it("resolves the organization from the project's organization", async () => {
    const access = fakeAccess(true);
    const app = guardedApp(access);
    await request(app)
      .patch(`/projects/${PROJECT}`)
      .set('Authorization', await auth())
      .expect(200);
    expect(access.resolveByProject).toHaveBeenCalledWith(PROJECT);
    await request(app)
      .patch(`/projects/${crypto.randomUUID()}`)
      .set('Authorization', await auth())
      .expect(404);
    await request(app)
      .patch('/projects/not-a-uuid')
      .set('Authorization', await auth())
      .expect(400);
  });

  it('404s an unknown organization or document before checking roles', async () => {
    const access = fakeAccess(true);
    const app = guardedApp(access);
    await request(app)
      .post('/orgs/psme/documents')
      .set('Authorization', await auth())
      .expect(404);
    await request(app)
      .patch(`/documents/${crypto.randomUUID()}`)
      .set('Authorization', await auth())
      .expect(404);
    expect(access.requireRole).not.toHaveBeenCalled();
  });

  it('400s a malformed :documentId or :slug', async () => {
    const app = guardedApp(fakeAccess(true));
    await request(app)
      .patch('/documents/not-a-uuid')
      .set('Authorization', await auth())
      .expect(400);
    await request(app)
      .post('/orgs/Bad_Slug/documents')
      .set('Authorization', await auth())
      .expect(400);
  });

  it('403s when the access service refuses', async () => {
    const app = guardedApp(fakeAccess(false));
    await request(app)
      .post('/orgs/jpice/documents')
      .set('Authorization', await auth())
      .expect(403);
    await request(app)
      .patch(`/documents/${DOC}/visibility`)
      .set('Authorization', await auth())
      .expect(403);
  });

  it('turns the admin override off for requireOwnOrgRole', async () => {
    const access = fakeAccess(true);
    await request(guardedApp(access))
      .patch(`/documents/${DOC}/visibility`)
      .set('Authorization', await auth())
      .expect(200);
    expect(access.requireRole).toHaveBeenCalledWith(
      USER,
      JPICE,
      ['officer'],
      expect.objectContaining({ route: '/documents/:documentId/visibility' }),
      { adminOverride: false },
    );
  });
});
