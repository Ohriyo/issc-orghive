import type { Request, RequestHandler, Response } from 'express';
import {
  announcementIdParamsSchema,
  BACKGROUND_REQUEST_HEADER,
  documentIdParamsSchema,
  ErrorCode,
  projectIdParamsSchema,
  slugParamsSchema,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import type { AccessService, OrgAccessScope, OrgRef } from '#src/services/access.service';
import type { AccessClaims, TokenService } from '#src/services/token.service';

const AUTH_KEY = 'auth';
const ORG_KEY = 'org';

/** The verified claims `requireAuth` attached. Throws if a route forgot to use it. */
export function authOf(res: Response): AccessClaims {
  const claims = (res.locals as Record<string, unknown>)[AUTH_KEY];
  if (!claims) throw new Error('authOf() called on a route without requireAuth');
  return claims as AccessClaims;
}

/**
 * What the auth guards need: token verification, plus (in the app) the super admin
 * session check. Every router receives the same object as `tokens`, so super admin
 * sessions get their idle timeout on every route without each router knowing about it.
 */
export interface AccessVerifier extends Pick<TokenService, 'verify'> {
  /** Ends an idle or expired super admin session (401); background requests don't count. */
  checkSession?(claims: AccessClaims, activity: { background: boolean }): Promise<void>;
}

export interface RequireAuthOptions {
  /**
   * Accept a token issued with a temporary password. Only the change-password route
   * (and /me, so the app can show who is signed in) sets this.
   */
  allowPasswordChange?: boolean;
  /**
   * Accept a super admin token from before the authenticator is confirmed. Only MFA setup
   * and /me set this.
   */
  allowMfaSetup?: boolean;
}

/** The claims `optionalAuth` attached, or undefined for a signed-out request. */
export function maybeAuthOf(res: Response): AccessClaims | undefined {
  return (res.locals as Record<string, unknown>)[AUTH_KEY] as AccessClaims | undefined;
}

async function authenticate(
  req: Request,
  res: Response,
  tokens: AccessVerifier,
  { allowPasswordChange = false, allowMfaSetup = false }: RequireAuthOptions,
) {
  const header = req.get('authorization');
  const match = header?.match(/^Bearer ([A-Za-z0-9_.-]+)$/);
  if (!match) throw AppError.unauthorized();

  const claims = await tokens.verify(match[1]!);
  if (claims.sessionId && tokens.checkSession) {
    await tokens.checkSession(claims, {
      background: req.get(BACKGROUND_REQUEST_HEADER) === '1',
    });
  }
  if (claims.mfaSetupRequired && !allowMfaSetup) {
    throw new AppError(
      403,
      ErrorCode.MFA_SETUP_REQUIRED,
      'Set up your authenticator app before continuing',
    );
  }
  if (claims.passwordChangeRequired && !allowPasswordChange) {
    throw new AppError(
      403,
      ErrorCode.PASSWORD_CHANGE_REQUIRED,
      'Change your temporary password before continuing',
    );
  }
  (res.locals as Record<string, unknown>)[AUTH_KEY] = claims;
}

/** Verifies `Authorization: Bearer <access token>`. */
export function requireAuth(
  tokens: AccessVerifier,
  options: RequireAuthOptions = {},
): RequestHandler {
  return async (req, res, next) => {
    await authenticate(req, res, tokens, options);
    next();
  };
}

/**
 * For public reads whose result depends on who is asking. No Authorization header means
 * signed out; a header that is present must still be valid (401 otherwise), so a broken
 * token never silently downgrades to the public view.
 */
export function optionalAuth(tokens: AccessVerifier): RequestHandler {
  return async (req, res, next) => {
    if (req.get('authorization') !== undefined) await authenticate(req, res, tokens, {});
    next();
  };
}

/** The organization an org guard resolved and authorized. Throws if no guard ran. */
export function orgOf(res: Response): OrgRef {
  const org = (res.locals as Record<string, unknown>)[ORG_KEY];
  if (!org) throw new Error('orgOf() called on a route without an org guard');
  return org as OrgRef;
}

/**
 * The target organization: from `:slug`, or from the owning organization of `:documentId`,
 * `:projectId` or `:announcementId`. 404 when it does not exist (or the document or project is deleted).
 */
async function resolveOrg(access: AccessService, req: Request): Promise<OrgRef> {
  if (req.params.slug !== undefined) {
    const { slug } = slugParamsSchema.parse({ slug: req.params.slug });
    const org = await access.resolveBySlug(slug);
    if (!org) throw AppError.notFound('Organization not found');
    return org;
  }
  if (req.params.documentId !== undefined) {
    const { documentId } = documentIdParamsSchema.parse({ documentId: req.params.documentId });
    const org = await access.resolveByDocument(documentId);
    if (!org) throw AppError.notFound('Document not found');
    return org;
  }
  if (req.params.projectId !== undefined) {
    const { projectId } = projectIdParamsSchema.parse({ projectId: req.params.projectId });
    const org = await access.resolveByProject(projectId);
    if (!org) throw AppError.notFound('Project not found');
    return org;
  }
  if (req.params.announcementId !== undefined) {
    const { announcementId } = announcementIdParamsSchema.parse({
      announcementId: req.params.announcementId,
    });
    const org = await access.resolveByAnnouncement(announcementId);
    if (!org) throw AppError.notFound('Update not found');
    return org;
  }
  throw new Error('Org guards need a :slug, :documentId, :projectId or :announcementId param');
}

/**
 * Guards for org-scoped routes, on shared organization accounts. Use after `requireAuth` on
 * every mutating route (CLAUDE.md). The account is read from the database, not the token.
 */
export function createOrgGuards(access: AccessService) {
  const guard =
    (scope: OrgAccessScope): RequestHandler =>
    async (req, res, next) => {
      const org = await resolveOrg(access, req);
      await access.requireOrgAccess(authOf(res).userId, org, scope);
      (res.locals as Record<string, unknown>)[ORG_KEY] = org;
      next();
    };

  return {
    /**
     * The target organization's own account, alone. Everything that changes its work:
     * uploads, visibility, deletes, projects, reports, updates.
     */
    requireOwnOrg: guard('own'),

    /**
     * The organization's own account or one of its governing bodies (its college's CSC, the
     * ISSC): reading its projects, compliance and appeals.
     */
    requireOrgOrGoverning: guard('governing'),

    /**
     * After an org guard: refuses writes for a deactivated organization (uploads and new
     * projects), whoever asks.
     */
    requireActiveOrg: (async (_req, res, next) => {
      await access.requireActive(orgOf(res));
      next();
    }) as RequestHandler,

    /** The ISSC account only (the /admin screens). Use after `requireAuth`. */
    requireAdmin: (async (_req, res, next) => {
      await access.requireAdmin(authOf(res).userId);
      next();
    }) as RequestHandler,
  };
}

export type OrgGuards = ReturnType<typeof createOrgGuards>;
