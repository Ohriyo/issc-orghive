import express from 'express';
import request from 'supertest';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@orghive/shared';
import { createErrorHandler } from '#src/middleware/error-handler';
import { authOf, requireAuth, requireOrgRole } from '#src/middleware/require-auth';
import { createTokenService } from '#src/services/token.service';
import { testKeys } from './auth-fixtures';

const USER = '0195f3c0-0000-7000-8000-000000000001';
const JPICE = '0195f3c0-0000-7000-8000-0000000000aa';
const PSME = '0195f3c0-0000-7000-8000-0000000000bb';
const tokens = createTokenService(testKeys());

/** A mutating route guarded the way CLAUDE.md requires. */
function guardedApp() {
  const app = express();
  app.post(
    '/orgs/:orgId/documents',
    requireAuth(tokens),
    requireOrgRole('officer', (req) => req.params.orgId as string),
    (_req, res) => {
      res.json({ userId: authOf(res).userId });
    },
  );
  app.use(createErrorHandler(pino({ level: 'silent' })));
  return app;
}

async function tokenFor(
  opts: {
    roles?: { orgId: string; role: 'officer' | 'adviser' }[];
    isAdmin?: boolean;
    passwordChangeRequired?: boolean;
  } = {},
) {
  const { token } = await tokens.sign({
    userId: USER,
    roles: (opts.roles ?? []).map((r) => ({ ...r, isHead: false })),
    isAdmin: opts.isAdmin ?? false,
    passwordChangeRequired: opts.passwordChangeRequired ?? false,
  });
  return token;
}

describe('requireAuth + requireOrgRole', () => {
  const app = guardedApp();
  const post = (orgId: string, token?: string) => {
    const req = request(app).post(`/orgs/${orgId}/documents`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('401: no token, a malformed header, or an invalid token', async () => {
    await post(JPICE).expect(401);
    await request(app)
      .post(`/orgs/${JPICE}/documents`)
      .set('Authorization', 'Basic abc')
      .expect(401);
    await post(JPICE, 'abc.def.ghi').expect(401);
  });

  it('403: a temporary-password token on any normal route', async () => {
    const res = await post(
      JPICE,
      await tokenFor({ roles: [{ orgId: JPICE, role: 'officer' }], passwordChangeRequired: true }),
    ).expect(403);
    expect(res.body.error.code).toBe(ErrorCode.PASSWORD_CHANGE_REQUIRED);
  });

  it('403: the role is held in another organization, or is a different role', async () => {
    await post(JPICE, await tokenFor({ roles: [{ orgId: PSME, role: 'officer' }] })).expect(403);
    await post(JPICE, await tokenFor({ roles: [{ orgId: JPICE, role: 'adviser' }] })).expect(403);
  });

  it('200: the officer of that organization, or an ISSC admin', async () => {
    const res = await post(
      JPICE,
      await tokenFor({ roles: [{ orgId: JPICE, role: 'officer' }] }),
    ).expect(200);
    expect(res.body).toEqual({ userId: USER });
    await post(JPICE, await tokenFor({ isAdmin: true })).expect(200);
  });
});
